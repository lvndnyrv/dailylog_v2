# Persistent Login Implementation

## Overview
The last successfully signed-in account (email + display name) is remembered on the device.
When the user returns to the login screen — **including after logging out** — they see a
"Welcome back" account card. Tapping it jumps straight to the password entry step, so they
never re-type their email.

## What Changed

### 1. **useAuth Hook** (`src/hooks/useAuth.js`)
- **`saveRememberedAccount(email, name?)`** *(internal)* — saves account to AsyncStorage.
  Called from `signIn()` (email only) and from the session handler once the profile loads
  (adds `full_name`, also covers magic-link/OTP sign-ins). If the email changes, a stale
  name is dropped.
- **`getRememberedAccount()`** → `{ email, name } | null` — exposed via context.
- **`clearRememberedAccount()`** — exposed via context; used by "Forget this account".
- **`signOut()`** — intentionally **keeps** the remembered account. This is the core of the
  feature: after logout, the user returns to an account card and only types their password.
- **`deleteAccount()`** — **clears** the remembered account (never suggest a deleted account).

### 2. **LoginScreen** (`src/screens/shared/LoginScreen.js`)
Four explicit UI modes (no mixed/duplicated forms):

| Mode | When | Shows |
|------|------|-------|
| `loading` | Reading storage on mount | Header only (prevents wrong-form flash) |
| `picker` | Remembered account exists | "Welcome back" + tappable account card (avatar initial, name, email) + "Use another account" + "Forget this account" |
| `password` | Account card tapped | Identity row (avatar, name, email, **"Not you?"** escape hatch) + auto-focused password field (submit on keyboard "go") |
| `full` | No remembered account, or "Use another account" | Email + password inputs + "Back to [saved email]" link if one exists |

Safety net: if the stored email is ever invalid, submitting in `password` mode falls back to
the `full` form with the visible error (no invisible-error dead end).

### 3. **ui.js `Input`**
Now forwards extra props (`...rest`) to the underlying `TextInput` — enables `autoFocus`,
`returnKeyType`, `onSubmitEditing`, `autoCapitalize`, `autoCorrect`. Backward compatible.

## Technical Details
- Storage: `@react-native-async-storage/async-storage` (already a dependency)
- Keys: `dailylog_remembered_email`, `dailylog_remembered_name`
- Only email + display name are stored — **never the password**
- All storage ops are try/catch-wrapped and fail silently (console warning)

## Lifecycle Rules
| Event | Remembered account |
|-------|--------------------|
| Successful sign-in (password) | Saved / replaced |
| Profile loads (any auth method, incl. OTP invite) | Name refreshed |
| **Sign out** | **Kept** (that's the point of the feature) |
| "Forget this account" on login screen | Cleared |
| Delete account | Cleared |

## Testing Checklist
- [ ] Fresh install → full email + password form shows (no account card)
- [ ] Sign in → sign out → login screen shows "Welcome back" account card
- [ ] Tap account card → password step with auto-focused password field
- [ ] Keyboard "go" submits the password
- [ ] Wrong password in password step → error banner, can retry or tap "Not you?"
- [ ] "Not you?" / "Use another account" → full form; "Back to [email]" returns to card
- [ ] "Forget this account" → card gone, full form shows, survives app restart
- [ ] Sign in with a different email → card shows the new account (old name not shown)
- [ ] Parent invited via magic link → their account card appears next time too
- [ ] Delete account → no account card on next launch
- [ ] Kill & relaunch app while logged out → account card still there

## Files Modified
1. `src/hooks/useAuth.js` — remembered-account persistence + lifecycle rules
2. `src/screens/shared/LoginScreen.js` — 4-mode login flow
3. `src/components/ui.js` — `Input` forwards extra TextInput props
