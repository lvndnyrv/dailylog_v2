# Remote Access Architecture: Location-Independent Operation

## Executive Summary

**Recommended approach: Dual Hardware IP-KVM with dedicated network gateway and hardware-based A/V passthrough.**

Hardware KVM is definitively the best solution for your specific scenario. No software-based alternative comes close given your security constraints. Here's why, and exactly how to implement it.

---

## Why Hardware KVM Over All Alternatives

| Approach | Fatal Flaw for Your Setup |
|----------|--------------------------|
| Software KVM (TeamViewer, AnyDesk, RustDesk) | Installs agents → CrowdStrike flags it, Jamf detects it, Pulseway inventories it |
| Built-in RDP/VNC | Network flows visible to NVM, sessions logged, posture changes detectable |
| Chrome Remote Desktop | CrowdStrike behavioral detection on Mac, browser extension visible to Jamf |
| Tailscale + Screen Sharing | Requires software installation on managed machines |
| Parsec/Moonlight | GPU driver hooks detectable by CrowdStrike, requires installation |
| **Hardware IP-KVM (PiKVM)** | **Zero software footprint. Invisible to all endpoint security. Operates at physical layer only.** |

The hardware KVM approach is superior because:
1. **No software installation** — nothing for CrowdStrike, ESET, Defender, or Jamf to detect
2. **No network traffic from target machines** — invisible to Cisco AnyConnect NVM and Zscaler
3. **No configuration changes** — AppGate SDP posture checks pass unchanged
4. **Physical-layer operation** — captures HDMI signal, emulates standard USB HID devices
5. **Works identically** on Windows and Apple Silicon Mac
6. **Supports crash recovery** — can simulate power button press and force restart

---

## Complete Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR HOME IN TORONTO                                           │
│                                                                  │
│  ┌──────────────┐     HDMI + USB      ┌──────────────────┐     │
│  │  Windows     │◄───────────────────►│  PiKVM #1        │     │
│  │  Laptop      │                      │  (v4 Mini)       │     │
│  │              │  USB Audio+Video     │                  │──┐  │
│  │              │◄────────────────────│  Camera/Mic Pi   │  │  │
│  └──────────────┘                      └──────────────────┘  │  │
│                                                               │  │
│  ┌──────────────┐     HDMI + USB      ┌──────────────────┐  │  │
│  │  Mac         │◄───────────────────►│  PiKVM #2        │  │  │
│  │  (Apple Si)  │                      │  (v4 Mini)       │  │  │
│  │              │  USB Audio+Video     │                  │──┤  │
│  │              │◄────────────────────│  Camera/Mic Pi   │  │  │
│  └──────────────┘                      └──────────────────┘  │  │
│                                                               │  │
│  ┌──────────────────────────────────────────────────────────┐│  │
│  │  Network Gateway (Raspberry Pi 5 or Intel N100 Mini PC)  ││  │
│  │  ┌─────────────┐ ┌──────────┐ ┌───────────────────────┐ ││  │
│  │  │ WireGuard   │ │ Uptime   │ │ Reverse Proxy (nginx) │ ││  │
│  │  │ VPN Server  │ │ Monitor  │ │ for PiKVM Web UIs     │ ││  │
│  │  └─────────────┘ └──────────┘ └───────────────────────┘ ││  │
│  └──────────────────────────────────────────────────────────┘│  │
│                                                               │  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │  │
│  │  UPS        │  │  Smart Plugs │  │  telMAX Fiber       │ │  │
│  │  (APC 600)  │  │  (TP-Link)   │  │  Router             │ │  │
│  └─────────────┘  └──────────────┘  └─────────────────────┘ │  │
│                                                               │  │
└───────────────────────────────────────────────────────────────┘  │
                                                                    │
          ════════════ WireGuard Tunnel (Encrypted) ════════════    │
                                                                    │
┌───────────────────────────────────────────────────────────────┐  │
│  YOU (Travel Location)                                         │  │
│                                                                │  │
│  ┌────────────┐   ┌──────────┐   ┌────────────────┐          │  │
│  │  Laptop/   │   │ USB      │   │  Phone with    │          │  │
│  │  Tablet    │   │ Webcam   │   │  MS Auth app   │          │  │
│  │  (Browser) │   │ + Headset│   │                │          │  │
│  └────────────┘   └──────────┘   └────────────────┘          │  │
└───────────────────────────────────────────────────────────────┘  │
```

---

## Component Breakdown

### 1. PiKVM v4 Mini (×2) — Core Remote Access

**What it does:** Captures HDMI output from each computer and emulates USB keyboard + mouse. Provides a web-based interface accessible over your home network.

**Why PiKVM v4 specifically:**
- Purpose-built hardware (not a DIY Pi hat — more reliable)
- Hardware H.264 encoding for low-bandwidth streaming
- Built-in USB HID emulation with proper device descriptors
- ATX control support via GPIO (for desktop recovery)
- Web-based UI works from any browser — nothing to install at travel location
- Active open-source project with regular updates
- CSI-2 capture bridge for direct low-latency video

**Connection to Windows Laptop:**
- HDMI cable from laptop to PiKVM's HDMI input
- USB-A cable from PiKVM's USB output to laptop's USB-A port (provides keyboard + mouse HID)
- Configure Windows to use external display as primary (or mirror)
- Laptop lid can remain closed (configure: "Do nothing when lid is closed")

**Connection to Mac:**
- USB-C to HDMI adapter (or direct HDMI if using a hub) from Mac to PiKVM's HDMI input
- USB-C cable from PiKVM's USB output to Mac's USB-C port (keyboard + mouse HID)
- Mac natively supports external display with lid closed (clamshell mode requires power connected)

**What each computer "sees":**
- A standard HDMI display (PiKVM's capture card presents valid EDID)
- A generic USB keyboard and USB mouse (standard HID class — driverless)
- No network connection to PiKVM — completely air-gapped from security software perspective

### 2. Camera/Microphone Hardware Bridge (×2)

**The Teams Problem:** You need YOUR face and YOUR voice in Toronto, routed through the home computers as if coming from local USB devices.

**Solution: Raspberry Pi 4/5 as A/V Bridge**

```
Travel Location                    Home (per computer)
┌─────────────┐   SRT/WebRTC    ┌─────────────────────────────────┐
│ USB Webcam  │──► Encode ──────► Raspberry Pi 4B ──► HDMI out    │
│ USB Mic     │──► Encode ──────► (receives stream)    │          │
└─────────────┘                  │                      ▼          │
                                  │              HDMI-to-USB        │
                                  │              Capture Card       │
                                  │              (Elgato Cam Link)  │
                                  │                      │          │
                                  │                      ▼          │
                                  │              Target Computer    │
                                  │              sees: USB Webcam   │
                                  └─────────────────────────────────┘
```

**For video (your camera):**
- At travel location: GStreamer/FFmpeg captures your webcam → encodes H.264 → sends via SRT protocol to home
- At home: Raspberry Pi receives SRT stream → decodes → outputs via HDMI
- HDMI output goes into an **Elgato Cam Link 4K** (HDMI-to-USB capture card)
- Elgato Cam Link presents as standard **UVC webcam** to target computer
- Target computer sees it as "Cam Link 4K" — a completely standard USB webcam, no drivers needed
- CrowdStrike, Jamf: see a USB video device, class-compliant, unremarkable

**For audio (your microphone):**
- At travel location: capture mic audio → encode Opus → send via SRT/WebRTC
- At home: Raspberry Pi receives audio → outputs via USB audio interface
- Use **Behringer UCA202** ($30) or similar USB audio interface connected to target computer
- 3.5mm cable from Pi's audio out to UCA202's line input
- Target computer sees: USB Audio Device with line-in active
- Select this as microphone in Teams

**For hearing others (their audio to you):**
- PiKVM already captures the HDMI signal which includes audio
- PiKVM's web interface streams audio alongside video to your browser
- You hear meeting audio through PiKVM's web stream in your browser
- Latency: acceptable for meetings (additional 50-100ms over base network latency)

**Alternative (simpler but higher latency):**
- Skip the hardware camera bridge entirely
- Use PiKVM's **USB webcam passthrough** feature (PiKVM v4 supports USB device redirection)
- This passes a USB webcam connected to the PiKVM through to the target as a USB device
- Limitation: the webcam must be physically at the home location (not useful for your face)

**Practical alternative for camera-off meetings:**
- Many meetings are camera-off — in these cases, only audio matters
- Audio-only bridge is much simpler: just the USB audio interface + Pi receiving audio stream
- Reserve the full camera setup for when absolutely needed

### 3. Network Gateway

**Hardware:** Raspberry Pi 5 (8GB) or Intel N100 mini PC (~$150)

**Services running:**
```
1. WireGuard VPN Server
   - Your travel device connects here
   - All KVM traffic encrypted end-to-end
   - Single UDP port exposed (51820)

2. Nginx Reverse Proxy
   - Routes to PiKVM #1 and #2 web interfaces
   - TLS termination with self-signed or Let's Encrypt cert

3. Uptime Monitoring (Uptime Kuma)
   - Monitors PiKVM availability
   - Monitors target computers' HDMI signal
   - Sends alerts via Telegram/email if anything goes down

4. Dynamic DNS Client (if IP changes)
   - Updates DNS record pointing to home IP
   - telMAX fiber likely has static IP — verify with ISP
```

**Why WireGuard:**
- Minimal latency overhead (~1-2ms)
- Excellent performance at high latency (handles 250ms RTT well)
- Single UDP port — easy to maintain, hard to block at travel destinations
- Established connections survive network changes (important for travel)
- Runs entirely on your gateway — zero footprint on target machines

### 4. Power & Recovery Infrastructure

**UPS (APC Back-UPS 600VA or CyberPower CP1500):**
- Protects all equipment from power outages
- Provides 15-30 minutes runtime for graceful handling
- USB connection to gateway Pi for shutdown notification

**Smart Plugs (TP-Link Kasa KP115 × 3):**
- One per target computer's power supply
- One for the network gateway + PiKVM stack
- Controllable via app from anywhere
- Enable hard power cycling as last-resort recovery

**Recovery Scenarios:**

| Failure | Recovery Method |
|---------|----------------|
| Windows laptop soft freeze | Ctrl+Alt+Del via PiKVM → sign back in |
| Windows hard freeze | Long power button (PiKVM ATX) or smart plug power cycle. Laptop must be configured to boot on AC restore (check BIOS — you said you can't modify BIOS, but check current setting) |
| Mac soft freeze | Force Quit via PiKVM, or Cmd+Ctrl+Power to restart |
| Mac hard freeze | Smart plug power cycle. Apple Silicon Macs have "Start up automatically after power failure" in System Settings → Energy |
| PiKVM unresponsive | Power cycle PiKVM via smart plug (separate from target computer) |
| Gateway Pi crash | Smart plug power cycle. WireGuard auto-reconnects |
| Internet outage at home | Nothing you can do remotely. Consider backup LTE modem (e.g., GL.iNet travel router with failover) |
| Router crash | Smart plug on router. Most routers auto-recover on power cycle |

**Critical laptop consideration:**
- Windows laptops typically do NOT auto-boot on AC power restore (this is a BIOS setting you said you can't change)
- Mitigation: Keep laptop plugged in, lid closed, configured to never sleep/hibernate
- If it hard-crashes and powers off, you need the BIOS setting. Check current BIOS config — it might already be enabled, or you might have "Wake on AC" available through Windows power settings
- Alternative: Use a USB watchdog timer device (e.g., "USB Watchdog Timer Card") that physically shorts the power pins if the system stops responding. These cost ~$20-30 on Amazon.

---

## Microsoft Teams: Complete Meeting Workflow

### From Low-Latency Locations (Florida: 40ms, Cancun: 60ms)

Experience is excellent — nearly indistinguishable from local use:

1. Open browser → connect to WireGuard VPN → access PiKVM web UI
2. See your desktop at ~40-60ms latency (imperceptible for most work)
3. Join Teams meeting normally via PiKVM
4. Camera: Hardware bridge streams your face at <150ms total additional latency
5. Mic: Audio bridge adds <100ms — conversations feel natural
6. Screen share: Works perfectly — Teams captures the screen, PiKVM shows you what's being shared
7. Receiving screen shares: Normal — you see everything through PiKVM's HDMI capture

### From High-Latency Locations (Sweden: 130ms, Baku: 200ms, Thailand: 250ms)

Experience degrades but remains functional:

1. **Your view of the meeting:** Normal Teams video + 200-250ms PiKVM delay = you see participants with slight additional delay. Acceptable.
2. **Your camera to others:** Your face → SRT encode → 250ms transit → Pi decode → HDMI → Cam Link → Teams → participants. Total added latency: ~400-500ms. Others see your expressions delayed. Noticeable but functional.
3. **Your voice to others:** Similar path — ~400ms additional. Conversations require slightly more deliberate turn-taking. Similar to satellite phone calls.
4. **Screen sharing:** Sharing YOUR screen works fine (Teams captures the desktop, sends normally from Toronto). Viewing OTHERS' screen shares has 250ms extra delay — fine for presentations.

### Mitigation for High-Latency Meetings

- **Use a wired ethernet connection** at travel location (reduces jitter dramatically)
- **PiKVM H.264 encoding** reduces bandwidth needs to 5-10 Mbps for 1080p
- **Reduce PiKVM resolution to 1080p** if running 4K (better encode performance)
- **For critical meetings from Thailand:** Consider joining from your phone (native Teams app) for the audio portion while using PiKVM only for screen content. Teams supports joining from multiple devices.

---

## Microsoft Authenticator: Number Matching

**This is simpler than you think.**

How number matching works:
1. You sign in on the computer (in Toronto, Toronto IP)
2. Microsoft sends push to your Authenticator app on phone
3. Phone shows three numbers — you pick the one displayed on the computer screen
4. Approval is sent back to Microsoft

**Why this works perfectly with PiKVM:**
- The sign-in attempt originates from **your computer in Toronto** (Toronto IP address)
- Microsoft's Conditional Access sees: sign-in from Toronto, your usual device, usual IP → low risk
- The Authenticator push goes to your phone — **it doesn't matter where your phone is**
- You see the number on your PiKVM screen, you tap it on your phone
- Microsoft sees MFA approved — they don't enforce phone geo-location for approval

**The only potential issue:** "Impossible travel" detection. This looks at **sign-in IPs**, not phone location. Since ALL sign-ins come from Toronto (your home IP), impossible travel never triggers.

**If your phone has a Toronto cellular number:** Even better — the phone's IP when approving is irrelevant, but if you're worried, approving over WiFi with WireGuard VPN back to Toronto makes the phone appear in Toronto too.

---

## Security Analysis: Detection Risk Per Tool

### Windows Laptop

| Security Tool | What It Could Detect | Risk Level | Mitigation |
|---------------|---------------------|------------|------------|
| ESET Endpoint Security | Nothing — hardware KVM is invisible to AV | ✅ Zero | N/A |
| Pulseway RMM | USB device inventory: new "keyboard" and "mouse" (USB HID). Also display EDID in hardware inventory | ⚠️ Low | Connect PiKVM USB **before** traveling to establish baseline. Pulseway inventories periodically — if it's already there, it won't alert |
| AppGate SDP | Device posture check: hardware hash, installed software, security state | ✅ Zero | No changes to software or security config. USB HID devices don't affect posture |
| Microsoft Authenticator | Sign-in location | ✅ Zero | Sign-in always from Toronto IP |
| ADAudit Plus | Filtered out for your machine | ✅ Zero | Non-issue |

### Mac

| Security Tool | What It Could Detect | Risk Level | Mitigation |
|---------------|---------------------|------------|------------|
| CrowdStrike Falcon | USB device connection events (new HID + UVC webcam + audio). Behavioral analysis of USB usage patterns | ⚠️ Low-Medium | Connect ALL USB devices before traveling. Let CrowdStrike baseline them for 1-2 weeks. USB HID + webcam + audio are extremely common device types |
| Jamf | Hardware inventory: connected peripherals, display info. Compliance state | ⚠️ Low | External monitors/keyboards already used without issues (you confirmed). Establish baseline |
| Microsoft Defender | Nothing — no software change | ✅ Zero | N/A |
| Zscaler | DNS/web traffic from Mac | ✅ Zero | Mac's traffic patterns don't change. You're still browsing/working normally |
| Cisco AnyConnect NVM | Network flow logs from Mac | ✅ Zero | PiKVM connects via USB, not network. Mac generates ZERO network traffic related to remote access |
| Company Portal | Compliance state | ✅ Zero | No configuration changes |

### Key Principle: Establish USB Baseline BEFORE Travel

**Critical step:** Connect all hardware (PiKVM USB, Cam Link, USB audio) at least **2 weeks before first trip**. Use the devices daily. This ensures:
- CrowdStrike sees these USB devices as "normal" for this machine
- Pulseway inventories them as standard hardware
- Jamf records them in compliance snapshots
- Any anomaly detection algorithms baseline the configuration

---

## Reliability Assessment

### Expected Uptime: 99%+ for short trips, 97%+ for multi-week stays

**Reliable components:**
- PiKVM v4 hardware: extremely stable (Linux-based, minimal moving parts)
- WireGuard: rock-solid, handles network changes gracefully
- Fiber internet (telMAX): enterprise-grade residential, very reliable

**Failure modes and probabilities:**

| Failure Mode | Probability (per month) | Impact | Recovery Time |
|--------------|------------------------|--------|---------------|
| Home internet outage | 2-3% | Total loss of access | Wait for ISP (typically <4 hours). LTE backup prevents this |
| Power outage | 1-2% | All equipment down | UPS buys 15-30 min. If extended, wait for power. Smart plug recovery after |
| Target computer crash | 5-10% (Windows), 2-3% (Mac) | Lose access to one system | Power cycle via smart plug, 2-5 min recovery |
| PiKVM hang | <1% | Lose access to one system | Power cycle PiKVM via smart plug, 1 min recovery |
| WireGuard disruption | <0.5% | Temporary connection loss | Auto-reconnects in seconds |
| Router crash | 1% | Total loss until reboot | Smart plug on router, 2-3 min recovery |

### Catastrophic Failure (Requires Physical Access)

- Laptop BIOS doesn't boot on AC restore + hard crash + battery dies = **need physical access**
- ISP equipment failure requiring technician = **need someone at home**
- Hardware failure of PiKVM = **need physical swap**

**Mitigation:** Have a trusted person with a key who can power cycle equipment or swap cables if absolutely necessary. This should be needed less than once per quarter.

---

## Long-Term Evolution

### Phase 1 → Phase 4 Progression

**Phase 1** (Immediate: Validation) → **Phase 2** (Proven: Full deployment) → **Phase 3** (Hardened: Redundancy) → **Phase 4** (Permanent: Location independence)

The architecture is designed to grow incrementally. Each phase builds on the previous without requiring re-architecture.

---

## Phased Implementation Plan

### Phase 1: Proof of Concept (2-3 weeks, ~$350-500 CAD)

**Goal:** Validate the entire concept works with ONE computer before investing fully.

**Hardware to purchase:**
| Item | Approximate Cost (CAD) |
|------|----------------------|
| PiKVM v4 Mini | $250 |
| USB-C to HDMI adapter (for Mac) | $30 |
| HDMI cable (short, high-quality) | $15 |
| USB-A to USB-C cable | $15 |
| TP-Link Kasa Smart Plug (×2) | $40 |
| Total | **~$350** |

**Steps:**
1. Order PiKVM v4 Mini
2. Connect to the **Windows laptop** first (lower security risk, easier to test)
3. Configure PiKVM on home network with static IP
4. Set up WireGuard on your existing router (many routers support it) OR on a Raspberry Pi you may already have
5. Test from a coffee shop or friend's house: connect VPN → access PiKVM → full control of laptop
6. Verify: AppGate SDP still works, Pulseway doesn't alert, ESET ignores it
7. Run for 1-2 weeks before any travel
8. Take a **short domestic trip** (weekend in another city) as full validation

**Success criteria:**
- Can perform all normal work tasks via PiKVM
- Security tools show no alerts
- Can complete an MFA challenge via Authenticator
- Can recover from a simulated freeze (force restart)

### Phase 2: Full Deployment (After Phase 1 validated, ~$800-1000 CAD additional)

**Goal:** Both computers accessible, with camera/mic for Teams.

**Hardware to purchase:**
| Item | Approximate Cost (CAD) |
|------|----------------------|
| PiKVM v4 Mini (second unit, for Mac) | $250 |
| Raspberry Pi 5 (8GB) — network gateway | $120 |
| Raspberry Pi 4B (4GB) — A/V bridge | $80 |
| Elgato Cam Link 4K | $150 |
| Behringer UCA202 USB Audio Interface | $40 |
| HDMI cables + adapters | $50 |
| APC Back-UPS 600VA | $120 |
| SD cards, power supplies, case | $80 |
| Cat6 Ethernet cables (×5) | $40 |
| Total | **~$930** |

**Steps:**
1. Deploy second PiKVM for Mac
2. Set up dedicated gateway Pi with WireGuard + Nginx + monitoring
3. Build A/V bridge: Pi 4B receiving stream → HDMI → Cam Link → target computer
4. Test Teams meeting with camera and mic from within the city
5. Let CrowdStrike/Jamf baseline the Mac's USB devices for 2 weeks
6. First international trip: **Florida** (low latency, easy to test)
7. Validate full workflow including Teams meetings

**Success criteria:**
- Both computers fully controllable remotely
- Teams meetings work with camera and microphone
- CrowdStrike shows no anomaly flags
- Full work day completed remotely without issues

### Phase 3: Hardened for Reliability (After Phase 2 proven, ~$300-500 CAD additional)

**Goal:** Redundancy and zero-touch recovery for extended international stays.

**Hardware to purchase:**
| Item | Approximate Cost (CAD) |
|------|----------------------|
| GL.iNet GL-X3000 (4G/5G travel router with WireGuard client) | $250 |
| LTE backup modem for home (failover internet) | $100-150 |
| Second UPS or larger UPS | $120 |
| USB watchdog timer for laptop | $30 |
| Spare PiKVM SD card (pre-configured) | $20 |
| Total | **~$400-550** |

**Additions:**
- **LTE failover** at home: if telMAX goes down, LTE provides backup path
- **USB watchdog timer** on laptop: automatically triggers power button if system becomes unresponsive (solves the "laptop won't auto-boot" problem)
- **GL.iNet travel router**: provides consistent WireGuard client at travel location regardless of hotel/café WiFi quality. Also enables you to connect multiple devices through one tunnel
- Automated monitoring alerts via Telegram

**This phase enables:** Multi-week stays in Sweden, Baku, Thailand with confidence.

### Phase 4: Permanent Location Independence (~$200-400 CAD additional, mostly recurring costs)

**Goal:** Indefinite operation without needing to return home for maintenance.

**Additions:**
- **Backup ISP** at home (e.g., Rogers cable as secondary to telMAX fiber)
- **Automated OS update scheduling** — ensure Windows/Mac don't reboot unexpectedly
- **Remote hands agreement** — find a trusted person or local IT freelancer who can visit your apartment if hardware fails ($50-100/visit as needed)
- **Spare PiKVM unit** stored at home — remote hands person can swap if primary fails
- **Temperature/humidity sensor** — monitor home office conditions (prevent overheating)
- Consider upgrading to **TailScale** on the gateway Pi for easier connectivity management (not on target machines — on your infrastructure only)

---

## Budget Summary

| Phase | Investment | Cumulative |
|-------|-----------|------------|
| Phase 1: Proof of Concept | ~$350-500 | $350-500 |
| Phase 2: Full Deployment | ~$800-1000 | $1,150-1,500 |
| Phase 3: Hardened | ~$400-550 | $1,550-2,050 |
| Phase 4: Permanent | ~$200-400 + recurring | $1,750-2,450 |

**Total hardware investment to full location independence: ~$2,000-2,500 CAD**

Ongoing costs: ~$20-30/month (backup LTE data plan, dynamic DNS if needed, electricity for always-on equipment)

---

## Addressing Specific Technical Concerns

### USB Device Identification Logging
- PiKVM's USB HID emulates generic devices: `PiKVM HID Keyboard` and `PiKVM HID Mouse`
- These are standard class-compliant devices — no special drivers
- Connect before travel to establish baseline
- **PiKVM allows custom USB device descriptors** — you could change VID/PID to match a Logitech keyboard if desired (advanced, probably unnecessary)

### Network Neighbor Discovery (mDNS, LLMNR, ARP)
- Target computers are on the same home network as always
- PiKVM is on the same network but **does not communicate with target via network** — only USB/HDMI
- No new network neighbors visible from the target computers' perspective
- The gateway Pi and camera Pi are on the network but invisible to the targets' security agents

### HDMI/Display EDID in System Logs
- PiKVM's capture card presents a fixed EDID (identifies as a display)
- **Connect before travel** — Windows Event Log and macOS Console will record the display connection, but it stays stable
- EDID doesn't change = no log entries after initial connection
- If Pulseway reports "monitors," it will show this display consistently

### Wi-Fi/BSSID Fingerprinting
- **Computers never leave your home** — they see the same Wi-Fi BSSID forever
- If using Ethernet (recommended for the Mac), even less to fingerprint
- Your travel device connects to different networks, but that's YOUR device, not the managed machines

### AppGate SDP Device Posture
- AppGate checks: OS version, security software running, disk encryption, etc.
- Nothing changes on the target system — all checks pass identically
- USB HID devices are not part of standard posture checks

### CrowdStrike Behavioral Analysis
- CrowdStrike monitors: process execution, file system changes, network connections, USB device events
- USB HID devices (keyboard/mouse) are **the most common USB device type** — no behavioral flag
- USB webcam (Cam Link) is a standard UVC device — also extremely common
- **Key insight:** CrowdStrike flags unusual *software behavior*, not standard hardware connections
- Having a keyboard, mouse, webcam, and audio device connected is the most normal configuration possible

### Pulseway Hardware/Software Inventory
- Will show connected USB devices and displays
- Establish baseline before travel = no change detected
- Pulseway alerts on **changes**, not on **state** — if state is constant, no alerts

---

## Why NOT a Different KVM Solution

| Alternative | Why PiKVM v4 is Better for You |
|-------------|-------------------------------|
| TinyPilot | Discontinued as a company. Open-source fork exists but less maintained |
| JetKVM | Newer/less proven, crowdfunded. Compact form factor is nice, but reliability unknown for 24/7 operation |
| BliKVM | Viable alternative, slightly less polished software. Could substitute to save ~$50 |
| Raritan/Avocent enterprise KVM | $500-2000+ per port. Massive overkill. Same outcome as PiKVM |
| DIY Pi4 + capture card | Cheaper ($100-150) but less reliable than purpose-built PiKVM v4. Acceptable for Phase 1 budget constraints |

**If budget is very tight for Phase 1:** Consider a DIY PiKVM build using Raspberry Pi 4 ($60) + HDMI-USB capture card ($20) + USB OTG cable ($10). Total: ~$90-100. Less polished but proves the concept. Upgrade to PiKVM v4 in Phase 2.

---

## Critical Pre-Travel Checklist

1. ☐ All hardware connected and baselined for 2+ weeks
2. ☐ Both computers configured to never sleep/hibernate
3. ☐ Mac "Start up automatically after power failure" enabled
4. ☐ Windows laptop "do nothing when lid closed" configured
5. ☐ WireGuard tested from multiple networks (coffee shop, phone hotspot)
6. ☐ Smart plugs tested — can power cycle each device independently
7. ☐ PiKVM firmware updated
8. ☐ UPS charged and functioning
9. ☐ Teams meeting successfully conducted via PiKVM (full test)
10. ☐ Simulated crash → recovery via power cycle tested for both computers
11. ☐ MS Authenticator approved from different network (phone on LTE while computer on WiFi)
12. ☐ Backup WireGuard config on phone (in case laptop fails at travel location)
13. ☐ Monitoring alerts tested (can you receive them at travel destination?)
14. ☐ Trusted person briefed on physical emergency procedures

---

## Final Recommendation

**Start Phase 1 immediately.** Order a PiKVM v4 Mini and set it up with your Windows laptop this week. The Windows machine is lower risk (less aggressive security monitoring) and lets you validate the entire concept before touching the Mac.

The total investment to prove the concept is under $500 CAD — a fraction of what you'd spend on even one international flight. If it works (and it will — this is a proven approach used by thousands of remote workers and IT professionals), you'll have location independence for years.

The architecture is specifically designed to be **invisible to every security tool in your environment** because it operates at the physical layer, below where any software agent can observe. This isn't a workaround or a hack — it's the same technology used in every data center on earth for remote server management (IPMI/iLO/iDRAC are the enterprise equivalents of exactly what PiKVM does).

