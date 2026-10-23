"use client";

import { ArrowLeft, ArrowRight, CircleHelp, Keyboard, LifeBuoy, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Article = {
  id: string;
  title: string;
  sections: string[];
  steps: string[];
  href: string;
  linkLabel: string;
};

const articles: Article[] = [
  { id: "ratios", title: "Understand a room ratio alert", sections: ["/dashboard", "/rooms", "/attendance"], steps: ["Open Rooms & ratios and select the flagged room.", "Compare children currently checked in with educators assigned and on the floor.", "Correct attendance or staff assignments if they are out of date. If the room is still over its center-entered ratio, arrange cover before accepting more children.", "Check your local licensing rules separately; DailyLog does not verify them."], href: "/rooms", linkLabel: "Open Rooms & ratios" },
  { id: "attention", title: "Work through the attention queue", sections: ["/dashboard", "/notifications"], steps: ["Open Dashboard to see items that need action.", "Choose an item to open its record, then complete the action there.", "Return to the queue to confirm the item has cleared. Some alerts update after the underlying record changes."], href: "/dashboard", linkLabel: "Open Dashboard" },
  { id: "billing", title: "Find an invoice and its payment status", sections: ["/billing", "/reports"], steps: ["Open Billing and search for the family or invoice.", "Open the invoice to review its current balance and payment history.", "For a disputed charge, check the invoice details before making a correction. Do not collect card numbers in messages."], href: "/billing", linkLabel: "Open Billing" },
  { id: "inspection", title: "Prepare inspection records", sections: ["/compliance", "/compliance/inspection"], steps: ["Open Compliance, then Inspection to review the current checklist.", "Check outstanding items and the documents attached to each record.", "Resolve missing or expired records in their source area, then refresh the inspection view."], href: "/compliance/inspection", linkLabel: "Open Inspection" },
  { id: "reports", title: "Export a report", sections: ["/reports"], steps: ["Open Reports and select the report you need.", "Choose a date range and any available filters before exporting.", "If a download does not open, try the other available format and check your browser's download permissions."], href: "/reports", linkLabel: "Open Reports" },
  { id: "enrollment", title: "Follow an enrollment record", sections: ["/enrollment", "/children"], steps: ["Open Enrollment and find the family or child.", "Review the current stage and any tasks still waiting on the center or family.", "Open the record for the next available action. Keep sensitive documents in the enrollment flow rather than a support message."], href: "/enrollment", linkLabel: "Open Enrollment" },
  { id: "account", title: "Manage your account and sessions", sections: ["/settings"], steps: ["Open Settings for your profile and account controls.", "Use the sessions list to review where your account is signed in.", "If you do not recognize a session, end it and change your password using the secure account flow."], href: "/settings", linkLabel: "Open Settings" },
];

const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function HelpCenter({ onOpen }: { onOpen?: () => void }) {
  const pathname = usePathname();
  const [view, setView] = useState<"closed" | "panel" | "article" | "shortcuts" | "message">("closed");
  const [query, setQuery] = useState("");
  const [articleId, setArticleId] = useState("ratios");
  const [topic, setTopic] = useState("General");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<"yes" | "no" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLInputElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const close = () => { setView("closed"); queueMicrotask(() => buttonRef.current?.focus()); };
  const currentArticle = articles.find((item) => item.id === articleId) ?? articles[0];
  const contextual = useMemo(() => articles.filter((item) => item.sections.some((section) => pathname === section || pathname.startsWith(`${section}/`))), [pathname]);
  const filtered = useMemo(() => articles.filter((item) => `${item.title} ${item.steps.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (view !== "closed") {
          setView("closed");
          queueMicrotask(() => buttonRef.current?.focus());
        }
      } else if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault();
        onOpen?.();
        setView(view === "closed" ? "panel" : "shortcuts");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpen, view]);

  useEffect(() => { if (view === "panel") queueMicrotask(() => panelRef.current?.focus()); }, [view]);
  useEffect(() => { if (view !== "panel" && view !== "closed") queueMicrotask(() => modalCloseRef.current?.focus()); }, [view]);
  const openArticle = (id: string) => { setArticleId(id); setFeedback(null); setView("article"); };
  const composeHref = supportEmail ? `mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(`DailyLog admin support: ${topic}`)}&body=${encodeURIComponent(`${message.trim()}\n\nScreen: ${pathname}\n\nPlease do not include passwords, pickup PINs, card numbers, or child medical documents.`)}` : null;

  return (
    <>
      <button ref={buttonRef} type="button" aria-label="Help and support" aria-expanded={view !== "closed"} aria-controls="admin-help-panel" onClick={() => { if (view === "closed") onOpen?.(); setView(view === "closed" ? "panel" : "closed"); }} className={`grid size-10 place-items-center rounded-[11px] border-[1.5px] transition-colors ${view !== "closed" ? "border-[#BFD6F2] bg-[#EAF1FB] text-primary" : "border-hairline bg-card text-body hover:bg-canvas"}`}><CircleHelp size={18} strokeWidth={1.7} aria-hidden /></button>
      {view !== "closed" && <>
        <button type="button" aria-label="Close help" className="fixed inset-0 z-30 cursor-default bg-ink/10" onClick={close} />
        {view === "panel" ? (
          <div id="admin-help-panel" role="dialog" aria-label="Help and support" className="absolute right-0 top-[46px] z-40 w-[376px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[16px] border-[1.5px] border-hairline bg-card shadow-[0_16px_44px_rgba(23,51,91,.22)]">
            <div className="border-b border-hairline p-4"><label className="flex items-center gap-2 rounded-[11px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3 py-2.5"><Search size={16} className="text-faint" aria-hidden /><input ref={panelRef} type="search" placeholder="Search help & articles…" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint" aria-label="Search help articles" /></label></div>
            <div className="max-h-[min(440px,60vh)] overflow-y-auto p-2.5">
              {!query && contextual.length > 0 && <><p className="px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">For this screen</p>{contextual.map((item) => <ArticleButton key={item.id} article={item} onClick={() => openArticle(item.id)} />)}</>}
              <p className="px-2 pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-wider text-faint">{query ? "Search results" : "Popular"}</p>
              {(query ? filtered : articles.filter((item) => !contextual.includes(item)).slice(0, 4)).map((item) => <ArticleButton key={item.id} article={item} onClick={() => openArticle(item.id)} />)}
              {query && filtered.length === 0 && <p className="px-2 py-4 text-sm text-muted">No articles found. Try another term or contact support.</p>}
            </div>
            <div className="flex items-center justify-between border-t border-hairline bg-[#FAFCFE] px-3 py-3"><button type="button" onClick={() => setView("shortcuts")} className="flex items-center gap-1.5 text-xs font-bold text-body hover:text-primary"><Keyboard size={15} aria-hidden />Shortcuts</button><button type="button" onClick={() => setView("message")} className="flex items-center gap-1.5 text-xs font-bold text-primary"><LifeBuoy size={15} aria-hidden />Message support</button></div>
          </div>
        ) : (
          <div id="admin-help-panel" role="dialog" aria-modal="true" aria-label={view === "article" ? currentArticle.title : view === "message" ? "Message support" : "Keyboard shortcuts"} className="fixed left-1/2 top-1/2 z-40 max-h-[min(700px,88vh)] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border border-hairline bg-card p-6 shadow-[0_18px_50px_rgba(23,51,91,.22)]">
            <div className="mb-4 flex items-center gap-2"><button type="button" aria-label="Back to help" onClick={() => setView("panel")} className="grid size-8 place-items-center rounded-lg hover:bg-canvas"><ArrowLeft size={18} aria-hidden /></button><h2 className="min-w-0 flex-1 text-lg font-extrabold text-ink">{view === "article" ? currentArticle.title : view === "message" ? "Message support" : "Keyboard shortcuts"}</h2><button ref={modalCloseRef} type="button" aria-label="Close help" onClick={close} className="grid size-8 place-items-center rounded-lg hover:bg-canvas"><X size={18} aria-hidden /></button></div>
            {view === "article" && <><ol className="space-y-3 pl-5 text-[13px] leading-6 text-body">{currentArticle.steps.map((step) => <li key={step} className="list-decimal pl-1">{step}</li>)}</ol><Link href={currentArticle.href} onClick={close} className="mt-5 inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:underline">{currentArticle.linkLabel}<ArrowRight size={15} aria-hidden /></Link><div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hairline pt-4 text-xs text-muted"><span>Was this helpful?</span>{(["yes", "no"] as const).map((value) => <button key={value} type="button" onClick={() => setFeedback(value)} aria-pressed={feedback === value} className={`rounded-full border px-3 py-1 font-bold ${feedback === value ? "border-primary bg-tint text-primary" : "border-hairline text-body hover:border-primary"}`}>{value === "yes" ? "Yes" : "No"}</button>)}<button type="button" onClick={() => setView("message")} className="ml-auto font-bold text-primary hover:underline">Still stuck →</button></div>{feedback && <p className="mt-2 text-xs text-muted">Thanks for the feedback.</p>}</>}
            {view === "shortcuts" && <div className="space-y-2 text-[13px] text-body"><Shortcut label="Open global search" keys="⌘/Ctrl + K" /><Shortcut label="Open help" keys="?" /><Shortcut label="Close panel or dialog" keys="Esc" /><Shortcut label="Move through search results" keys="↑ / ↓" /><Shortcut label="Open selected search result" keys="Enter" /><p className="pt-2 text-xs text-muted">Shortcuts are inactive while typing in a field.</p></div>}
            {view === "message" && (
              supportEmail ? <div className="space-y-4">
                <p className="text-[13px] leading-5 text-body">Describe what happened. Don&apos;t include passwords, pickup PINs, card numbers, or a child&apos;s medical document.</p>
                <div><span className="mb-2 block text-xs font-bold text-ink">What&apos;s it about?</span><div className="flex flex-wrap gap-1.5">{["General", "Ratios", "Billing", "Compliance", "Account"].map((value) => <button key={value} type="button" onClick={() => setTopic(value)} aria-pressed={topic === value} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${topic === value ? "border-primary bg-primary text-white" : "border-hairline bg-canvas text-body"}`}>{value}</button>)}</div></div>
                <label className="block text-xs font-bold text-ink">Your message<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={5} placeholder="What were you trying to do? What happened instead?" className="mt-2 w-full resize-y rounded-[12px] border-[1.5px] border-[#D6E1F0] p-3 text-[13px] font-normal text-ink outline-none focus:border-primary" /></label>
                <p className="text-xs text-muted">This opens your email app with a draft. Review and send it there; DailyLog will not send it automatically.</p>
                <a href={message.trim() ? composeHref ?? undefined : undefined} onClick={(event) => { if (!message.trim()) event.preventDefault(); }} aria-disabled={!message.trim()} className={`inline-block rounded-full px-5 py-2.5 text-[13px] font-bold text-white ${message.trim() ? "bg-primary hover:bg-primary-hover" : "cursor-not-allowed bg-primary/40"}`}>Open email draft</a>
              </div> : <div className="space-y-4">
                <p className="text-[13px] leading-6 text-body">Direct support messaging is not configured for this installation. No message can be sent from here yet.</p>
                <p className="rounded-lg bg-canvas p-3 text-xs leading-5 text-body">For a center record or account question, contact your center administrator. For sign-in and app troubleshooting, see the support page.</p>
                <Link href="/support" onClick={close} className="inline-block rounded-full bg-primary px-5 py-2.5 text-[13px] font-bold text-white">Open support page</Link>
              </div>
            )}
          </div>
        )}
      </>}
    </>
  );
}

function ArticleButton({ article, onClick }: { article: Article; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] font-semibold text-ink hover:bg-canvas"><span className="grid size-7 flex-none place-items-center rounded-lg bg-tint text-primary"><CircleHelp size={15} aria-hidden /></span><span className="flex-1">{article.title}</span><ArrowRight size={14} className="text-faint" aria-hidden /></button>;
}

function Shortcut({ label, keys }: { label: string; keys: string }) {
  return <div className="flex items-center justify-between gap-3"><span>{label}</span><kbd className="rounded-md border border-[#D6E1F0] bg-canvas px-2 py-1 font-mono text-[11px] text-ink">{keys}</kbd></div>;
}
