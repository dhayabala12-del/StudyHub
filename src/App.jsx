import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen, Upload, MessageCircle, Layers, FileText, Brain, Plus, X,
  Check, ChevronRight, LogOut, Sparkles, Send, Loader2, ShieldCheck,
  FilePlus2, Image as ImageIcon, GraduationCap, RotateCw, ChevronLeft,
  AlertCircle, Menu, Trash2, Stamp, Flame, TrendingUp, Award, ThumbsUp, ThumbsDown,
  Download, DatabaseBackup, Target, ClipboardCheck, Clock, ArrowRight
} from "lucide-react";
import { supabase } from "./supabaseClient";

const ADMIN_EMAIL = "dhayabala12@gmail.com";
const ALLOWED_DOMAINS = ["gmail.com", "duvalschools.org"];
function isAllowedEmail(email) {
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[1] && ALLOWED_DOMAINS.includes(parts[1]);
}
const SUBJECT_COLORS = ["#E8B23D", "#4FBDBA", "#C97064", "#8B7FD6", "#6FA97B", "#D68FB0"];

/* ---------------- storage helpers (Supabase-backed) ---------------- */
async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}
async function sGet(key, shared) {
  try {
    const uid = await currentUserId();
    if (!shared && !uid) return null;
    let query = supabase.from("kv_store").select("value").eq("key", key).eq("shared", shared);
    if (!shared) query = query.eq("owner", uid);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data ? data.value : null;
  } catch (e) { console.error(e); return null; }
}
async function sSet(key, value, shared) {
  try {
    const uid = await currentUserId();
    if (!uid) return;
    const { error } = await supabase
      .from("kv_store")
      .upsert(
        { key, value, shared, owner: uid, updated_at: new Date().toISOString() },
        { onConflict: "owner,key" }
      );
    if (error) throw error;
  } catch (e) { console.error(e); }
}
async function sDelete(key, shared) {
  try {
    const uid = await currentUserId();
    if (!uid) return;
    await supabase.from("kv_store").delete().eq("key", key).eq("owner", uid);
  } catch (e) { console.error(e); }
}
async function sList(prefix, shared) {
  try {
    const uid = await currentUserId();
    if (!shared && !uid) return [];
    let query = supabase.from("kv_store").select("key").eq("shared", shared).like("key", `${prefix}%`);
    if (!shared) query = query.eq("owner", uid);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r) => r.key);
  } catch (e) { console.error(e); return []; }
}
function safeJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/* ---------------- progress tracking (personal, per student) ---------------- */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
async function touchStreak() {
  const raw = await sGet("streak", false);
  const s = safeJSON(raw, { current: 0, longest: 0, lastDate: null });
  const today = todayStr();
  if (s.lastDate === today) return s;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  s.current = s.lastDate === yesterday ? s.current + 1 : 1;
  s.longest = Math.max(s.longest || 0, s.current);
  s.lastDate = today;
  await sSet("streak", JSON.stringify(s), false);
  return s;
}
async function getStreak() {
  const raw = await sGet("streak", false);
  return safeJSON(raw, { current: 0, longest: 0, lastDate: null });
}
async function getProgress(subjectId) {
  const raw = await sGet(`progress:${subjectId}`, false);
  return safeJSON(raw, { summaryReviewed: null, notesReviewed: null, flashcards: {}, practice: {}, history: [] });
}
async function saveProgress(subjectId, progress) {
  await sSet(`progress:${subjectId}`, JSON.stringify(progress), false);
}
function logEvent(progress, entry) {
  if (!progress.history) progress.history = [];
  progress.history.unshift({ id: "ev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), ts: Date.now(), ...entry });
  progress.history = progress.history.slice(0, 60);
}
async function markReviewed(subjectId, kind) {
  const p = await getProgress(subjectId);
  p[kind === "summary" ? "summaryReviewed" : "notesReviewed"] = Date.now();
  logEvent(p, { type: "reviewed", label: kind === "summary" ? "Reviewed the Summary" : "Reviewed the Notes" });
  await saveProgress(subjectId, p);
  await touchStreak();
  return p;
}
async function rateFlashcard(subjectId, cardId, knewIt, cardFront) {
  const p = await getProgress(subjectId);
  const prev = p.flashcards[cardId] || { streak: 0, seen: 0, mastered: false };
  prev.seen += 1;
  prev.streak = knewIt ? prev.streak + 1 : 0;
  const justMastered = !prev.mastered && prev.streak >= 3;
  prev.mastered = prev.streak >= 3;
  p.flashcards[cardId] = prev;
  logEvent(p, {
    type: "flashcard",
    label: (cardFront || "Flashcard").slice(0, 70),
    correct: knewIt,
    badge: justMastered ? "Mastered" : null,
  });
  await saveProgress(subjectId, p);
  await touchStreak();
  return p;
}
async function recordPracticeAttempt(subjectId, diff, qId, correct, questionText) {
  const p = await getProgress(subjectId);
  if (!p.practice[diff]) p.practice[diff] = {};
  const prev = p.practice[diff][qId] || { attempts: 0, correct: 0, streak: 0 };
  prev.attempts += 1;
  if (correct) { prev.correct += 1; prev.streak += 1; } else { prev.streak = 0; }
  p.practice[diff][qId] = prev;
  const diffLabel = (DIFFICULTIES.find((d) => d.id === diff) || {}).label || diff;
  logEvent(p, {
    type: "practice",
    label: (questionText || "Practice question").slice(0, 70),
    correct,
    badge: diffLabel,
  });
  await saveProgress(subjectId, p);
  await touchStreak();
  return p;
}
async function recordTutorMessage(subjectId, questionText) {
  const p = await getProgress(subjectId);
  if (!p.tutor) p.tutor = { questions: 0, sessions: 0, helpful: 0, notHelpful: 0, lastTs: null };
  const now = Date.now();
  const gapMs = p.tutor.lastTs ? now - p.tutor.lastTs : Infinity;
  if (gapMs > 30 * 60 * 1000) p.tutor.sessions += 1;
  p.tutor.questions += 1;
  p.tutor.lastTs = now;
  logEvent(p, { type: "tutor", label: (questionText || "Asked the AI Tutor").slice(0, 70) });
  await saveProgress(subjectId, p);
  await touchStreak();
  return p;
}
async function rateTutorHelpfulness(subjectId, helpful) {
  const p = await getProgress(subjectId);
  if (!p.tutor) p.tutor = { questions: 0, sessions: 0, helpful: 0, notHelpful: 0, lastTs: null };
  if (helpful) p.tutor.helpful += 1; else p.tutor.notHelpful += 1;
  await saveProgress(subjectId, p);
  return p;
}
function diffStats(progress, diffId) {
  const entries = Object.values((progress.practice || {})[diffId] || {});
  const attempted = entries.length;
  const correct = entries.filter((e) => e.correct > 0 && e.streak > 0).length;
  const accuracy = entries.length
    ? Math.round((entries.reduce((s, e) => s + e.correct, 0) / entries.reduce((s, e) => s + e.attempts, 0)) * 100)
    : 0;
  const mastered = entries.filter((e) => e.streak >= 2).length;
  return { attempted, accuracy, mastered };
}

function computeTopicBreakdown(cards, questionsByDiff, progress) {
  const topics = {};
  const ensure = (t) => { if (!topics[t]) topics[t] = { topic: t, flashTotal: 0, flashMastered: 0, flashAttempted: 0, practiceTotal: 0, practiceAttempted: 0, practiceCorrect: 0, practiceAttempts: 0 }; return topics[t]; };

  for (const c of cards || []) {
    const t = ensure(c.topic || "General");
    t.flashTotal += 1;
    const pc = (progress.flashcards || {})[c.id];
    if (pc) { t.flashAttempted += 1; if (pc.mastered) t.flashMastered += 1; }
  }
  for (const diffId of Object.keys(questionsByDiff || {})) {
    for (const q of questionsByDiff[diffId] || []) {
      const t = ensure(q.topic || "General");
      t.practiceTotal += 1;
      const pq = (progress.practice || {})[diffId]?.[q.id];
      if (pq) {
        t.practiceAttempted += 1;
        t.practiceCorrect += pq.correct;
        t.practiceAttempts += pq.attempts;
      }
    }
  }

  return Object.values(topics).map((t) => {
    const flashScore = t.flashTotal ? (t.flashMastered / t.flashTotal) * 100 : null;
    const practiceScore = t.practiceAttempts ? (t.practiceCorrect / t.practiceAttempts) * 100 : null;
    const scores = [flashScore, practiceScore].filter((s) => s !== null);
    const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const started = t.flashAttempted > 0 || t.practiceAttempted > 0;
    const totalItems = t.flashTotal + t.practiceTotal;
    return { ...t, score, started, totalItems };
  }).sort((a, b) => {
    const av = a.started ? a.score : -1;
    const bv = b.started ? b.score : -1;
    return av - bv;
  });
}

/* ---------------- Claude API helper (via our own backend proxy) ---------------- */
async function callClaude({ system, messages, maxTokens = 1000 }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maxTokens,
      system,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Claude proxy error:", data?.error);
    throw new Error(data?.error || "AI request failed");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return text;
}
function stripFence(text) {
  return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

/* ---------------- root ---------------- */
function userFromSession(session) {
  const email = session?.user?.email;
  if (!email) return null;
  return { email, isAdmin: email.trim().toLowerCase() === ADMIN_EMAIL };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(userFromSession(data?.session));
      setBooting(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(userFromSession(session));
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (booting) return <Shell><LoadingSpinner label="Opening your notebook…" /></Shell>;
  if (!user) return <Shell><LoginScreen /></Shell>;
  return <Shell><Workspace user={user} onLogout={handleLogout} /></Shell>;
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--ink)", fontFamily: "var(--font-body)" }}>
      <GlobalStyle />
      {children}
    </div>
  );
}

function LoadingSpinner({ label }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ minHeight: "100vh", gap: 12 }}>
      <Loader2 className="spin" size={28} color="var(--accent-verify)" />
      <span style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: 1 }}>
        {label}
      </span>
    </div>
  );
}

/* ---------------- login ---------------- */
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const valid = isAllowedEmail(email);
  const showError = touched && email.length > 0 && !valid;

  const submit = async () => {
    if (!valid) { setTouched(true); return; }
    setSending(true);
    setErr("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "100vh", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div className="flex flex-col items-center" style={{ marginBottom: 32 }}>
            <div className="brandmark">S</div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, color: "var(--paper)", marginTop: 16, marginBottom: 4 }}>
              StudyHub
            </h1>
          </div>
          <div className="card" style={{ padding: 28, textAlign: "center" }}>
            <ShieldCheck size={28} color="var(--accent-verify)" style={{ marginBottom: 10 }} />
            <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 6 }}>Check your email</p>
            <p style={{ color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5 }}>
              We sent a sign-in link to <strong>{email}</strong>. Open it on this device to finish logging in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center" style={{ minHeight: "100vh", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="flex flex-col items-center" style={{ marginBottom: 32 }}>
          <div className="brandmark">S</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, color: "var(--paper)", marginTop: 16, marginBottom: 4 }}>
            StudyHub
          </h1>
          <span className="stamp-chip" style={{ marginBottom: 10 }}>For students in JWJ 8th to succeed</span>
          <p style={{ color: "var(--ink-soft)", fontSize: 14, textAlign: "center" }}>
            Study only what your teacher actually taught. Nothing else.
          </p>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <label style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1.2, color: "var(--ink-soft)", marginBottom: 8, textTransform: "uppercase" }}>
            Sign in with your school email
          </label>
          <input
            type="email"
            value={email}
            placeholder="you@duvalschools.org"
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="input"
          />
          {showError && (
            <div className="error-line" style={{ marginTop: 8, marginBottom: 0 }}>
              <AlertCircle size={13} /> Use your @duvalschools.org email (or a @gmail.com account).
            </div>
          )}
          {err && (
            <div className="error-line" style={{ marginTop: 8, marginBottom: 0 }}>
              <AlertCircle size={13} /> {err}
            </div>
          )}
          <button
            className="btn-primary"
            style={{ width: "100%", marginTop: 14 }}
            disabled={!valid || sending}
            onClick={submit}
          >
            <ShieldCheck size={16} /> {sending ? "Sending link…" : "Continue"}
          </button>
          <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 16, lineHeight: 1.5 }}>
            Only your teacher's account can upload
            or edit source material. Everyone else opens in study mode automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- workspace ---------------- */
const TABS = [
  { id: "materials", label: "Materials", icon: FileText },
  { id: "summary", label: "Summary", icon: BookOpen },
  { id: "flashcards", label: "Flashcards", icon: Layers },
  { id: "practice", label: "Practice", icon: GraduationCap },
  { id: "focus", label: "Focus", icon: Target },
  { id: "test", label: "Practice Test", icon: ClipboardCheck },
  { id: "notes", label: "Notes", icon: FilePlus2 },
  { id: "tutor", label: "AI Tutor", icon: MessageCircle },
  { id: "progress", label: "Progress", icon: TrendingUp },
];

function Workspace({ user, onLogout }) {
  const [subjects, setSubjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("materials");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addSubjectOpen, setAddSubjectOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  const loadSubjects = useCallback(async () => {
    const raw = await sGet("subjects", true);
    let list = safeJSON(raw, []);
    if (list.length === 0) {
      const backupRaw = await sGet("subjects_backup", true);
      const backup = safeJSON(backupRaw, []);
      if (backup.length > 0) {
        list = backup;
        await sSet("subjects", JSON.stringify(list), true);
      }
    }
    setSubjects(list);
    if (!selectedId && list.length) setSelectedId(list[0].id);
    setLoadingSubjects(false);
  }, [selectedId]);

  useEffect(() => { loadSubjects(); }, []);

  const saveSubjects = async (list) => {
    setSubjects(list);
    await sSet("subjects", JSON.stringify(list), true);
    await sSet("subjects_backup", JSON.stringify(list), true);
  };

  const addSubject = async (name) => {
    const color = SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
    const s = { id: "sub_" + Date.now(), name, color, createdAt: Date.now() };
    const updated = [...subjects, s];
    await saveSubjects(updated);
    setSelectedId(s.id);
    setAddSubjectOpen(false);
    setDrawerOpen(false);
  };

  const deleteSubject = async (id) => {
    const updated = subjects.filter((s) => s.id !== id);
    await saveSubjects(updated);
    if (selectedId === id) setSelectedId(updated[0]?.id || null);
  };

  const selected = subjects.find((s) => s.id === selectedId) || null;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />
      )}
      <Sidebar
        subjects={subjects}
        loading={loadingSubjects}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setTab("materials"); setDrawerOpen(false); }}
        user={user}
        onLogout={onLogout}
        onAddSubject={() => setAddSubjectOpen(true)}
        onDeleteSubject={deleteSubject}
        onOpenBackup={() => setBackupModalOpen(true)}
        open={drawerOpen}
      />

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setDrawerOpen(true)}>
            <Menu size={20} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {selected && <span className="dot" style={{ background: selected.color }} />}
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--paper)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selected ? selected.name : "No subject yet"}
            </h2>
          </div>
          <div style={{ marginLeft: "auto" }} className="desktop-only">
            <span className="stamp-chip"><Stamp size={12} /> Teacher-verified content only</span>
          </div>
        </header>

        {selected ? (
          <>
            <nav className="tabbar">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    className={"tab-pill" + (tab === t.id ? " active" : "")}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={15} /> {t.label}
                  </button>
                );
              })}
            </nav>
            <div style={{ flex: 1, padding: "20px 24px 60px", overflowY: "auto" }}>
              {tab === "materials" && <MaterialsTab subject={selected} user={user} />}
              {tab === "summary" && <GeneratedTextTab subject={selected} kind="summary" title="Summary" />}
              {tab === "notes" && <GeneratedTextTab subject={selected} kind="notes" title="Notes" />}
              {tab === "flashcards" && <FlashcardsTab subject={selected} />}
              {tab === "practice" && <PracticeTab subject={selected} />}
              {tab === "focus" && <FocusTab subject={selected} />}
              {tab === "test" && <PracticeTestTab subject={selected} />}
              {tab === "tutor" && <TutorTab subject={selected} />}
              {tab === "progress" && <ProgressTab subject={selected} />}
            </div>
          </>
        ) : (
          <EmptyState isAdmin={user.isAdmin} onAdd={() => setAddSubjectOpen(true)} />
        )}
      </main>

      {addSubjectOpen && (
        <AddSubjectModal onClose={() => setAddSubjectOpen(false)} onCreate={addSubject} />
      )}
      {backupModalOpen && (
        <BackupModal subjects={subjects} onClose={() => setBackupModalOpen(false)} onRestored={loadSubjects} />
      )}
    </div>
  );
}

function EmptyState({ isAdmin, onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ flex: 1, padding: 40, textAlign: "center" }}>
      <BookOpen size={40} color="var(--ink-soft)" />
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--paper)", marginTop: 16 }}>
        {isAdmin ? "Start your first class shelf" : "No classes are open yet"}
      </h3>
      <p style={{ color: "var(--ink-soft)", maxWidth: 360, marginTop: 8, fontSize: 14 }}>
        {isAdmin
          ? "Create a subject (like Biology or Algebra II), then upload the exact materials your class used."
          : "Ask your teacher to add a subject and upload materials — this space stays empty until they do."}
      </p>
      {isAdmin && (
        <button className="btn-primary" style={{ marginTop: 20 }} onClick={onAdd}>
          <Plus size={16} /> Add a subject
        </button>
      )}
    </div>
  );
}

function AddSubjectModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  return (
    <ModalShell onClose={onClose} title="New subject shelf">
      <label className="field-label">Subject or class name</label>
      <input
        className="input"
        autoFocus
        placeholder="e.g. Biology, Algebra II, US History"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); }}
      />
      <button className="btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
        Create shelf
      </button>
    </ModalShell>
  );
}

function ModalShell({ onClose, title, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: wide ? 560 : 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--paper)" }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- backup & restore ---------------- */
async function exportAllData(subjects) {
  const data = { exportedAt: Date.now(), subjects, materials: {}, summary: {}, notes: {}, flashcards: {}, practice: {} };
  for (const s of subjects) {
    data.materials[s.id] = safeJSON(await sGet(`materials:${s.id}`, true), []);
    data.summary[s.id] = (await sGet(`summary:${s.id}`, true)) || "";
    data.notes[s.id] = (await sGet(`notes:${s.id}`, true)) || "";
    data.flashcards[s.id] = {};
    data.practice[s.id] = {};
    for (const d of DIFFICULTIES) {
      data.flashcards[s.id][d.id] = safeJSON(await sGet(`flashcards:${s.id}:${d.id}`, true), []);
      data.practice[s.id][d.id] = safeJSON(await sGet(`practice:${s.id}:${d.id}`, true), []);
    }
  }
  return data;
}
async function importAllData(data) {
  const subjects = data.subjects || [];
  await sSet("subjects", JSON.stringify(subjects), true);
  await sSet("subjects_backup", JSON.stringify(subjects), true);
  for (const s of subjects) {
    if (data.materials?.[s.id]) await sSet(`materials:${s.id}`, JSON.stringify(data.materials[s.id]), true);
    if (data.summary?.[s.id]) await sSet(`summary:${s.id}`, data.summary[s.id], true);
    if (data.notes?.[s.id]) await sSet(`notes:${s.id}`, data.notes[s.id], true);
    for (const d of DIFFICULTIES) {
      const legacyFlashcards = Array.isArray(data.flashcards?.[s.id]) ? data.flashcards[s.id] : null;
      const tieredFlashcards = data.flashcards?.[s.id]?.[d.id];
      if (tieredFlashcards) await sSet(`flashcards:${s.id}:${d.id}`, JSON.stringify(tieredFlashcards), true);
      else if (legacyFlashcards && d.id === "standard") await sSet(`flashcards:${s.id}:standard`, JSON.stringify(legacyFlashcards), true);
      if (data.practice?.[s.id]?.[d.id]) await sSet(`practice:${s.id}:${d.id}`, JSON.stringify(data.practice[s.id][d.id]), true);
    }
  }
}

function BackupModal({ subjects, onClose, onRestored }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const doExport = async () => {
    setExporting(true);
    setError("");
    setStatus("");
    try {
      const data = await exportAllData(subjects);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `studyhub-backup-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded a backup of ${subjects.length} subject${subjects.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError("Couldn't create the backup file. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const doImport = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    setStatus("");
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.subjects)) throw new Error("bad file");
      await importAllData(data);
      await onRestored();
      setStatus(`Restored ${data.subjects.length} subject${data.subjects.length === 1 ? "" : "s"} from backup.`);
    } catch (e) {
      setError("That doesn't look like a valid StudyHub backup file.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <ModalShell onClose={onClose} title="Backup & restore" wide>
      <p style={{ color: "var(--ink-soft)", fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
        Downloads everything — subjects, materials, summaries, flashcards, and practice questions — into one file on your device. Do this before publishing changes, so you can restore instantly if anything resets.
      </p>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="flex items-center justify-between">
          <div>
            <div style={{ color: "var(--paper)", fontSize: 14, fontWeight: 600 }}>Export backup</div>
            <div style={{ color: "var(--ink-soft)", fontSize: 12 }}>Save everything to a file right now</div>
          </div>
          <button className="btn-primary" disabled={exporting || subjects.length === 0} onClick={doExport}>
            {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Export
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ color: "var(--paper)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Restore from backup</div>
        <div style={{ color: "var(--ink-soft)", fontSize: 12, marginBottom: 10 }}>This adds the backup's subjects on top of what's here now — it won't erase anything current.</div>
        <input ref={fileRef} type="file" accept="application/json" className="input" style={{ padding: 10 }} />
        <button className="btn-secondary" style={{ width: "100%", marginTop: 10 }} disabled={importing} onClick={doImport}>
          {importing ? <><Loader2 size={14} className="spin" /> Restoring…</> : <><Upload size={14} /> Restore this file</>}
        </button>
      </div>

      {status && <div style={{ color: "var(--accent-green)", fontSize: 13, marginTop: 12 }}>{status}</div>}
      {error && <div className="error-line" style={{ marginTop: 12 }}><AlertCircle size={13} /> {error}</div>}
    </ModalShell>
  );
}

/* ---------------- sidebar ---------------- */
function Sidebar({ subjects, loading, selectedId, onSelect, user, onLogout, onAddSubject, onDeleteSubject, onOpenBackup, open }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div style={{ padding: "22px 18px 14px" }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <div className="brandmark small">S</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--paper)", lineHeight: 1.1 }}>StudyHub</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: 0.4, color: "var(--ink-soft)", textTransform: "uppercase" }}>For students in JWJ 8th to succeed</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 14px", flex: 1, overflowY: "auto" }}>
        <div className="flex items-center justify-between" style={{ padding: "6px 6px 8px" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 1.2, color: "var(--ink-soft)", textTransform: "uppercase" }}>
            Class shelves
          </span>
          {user.isAdmin && (
            <button className="icon-btn" onClick={onAddSubject}><Plus size={16} /></button>
          )}
        </div>
        {loading && <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: 8 }}>Loading…</div>}
        {!loading && subjects.length === 0 && (
          <div style={{ color: "var(--ink-soft)", fontSize: 13, padding: 8 }}>No subjects yet.</div>
        )}
        {subjects.map((s) => (
          <div key={s.id} className={"shelf-item" + (s.id === selectedId ? " active" : "")} onClick={() => confirmDeleteId !== s.id && onSelect(s.id)}>
            <span className="dot" style={{ background: s.color }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            {user.isAdmin && (
              confirmDeleteId === s.id ? (
                <div className="flex items-center" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <span style={{ fontSize: 10.5, color: "var(--accent-red)" }}>Delete?</span>
                  <button className="icon-btn tiny" style={{ color: "var(--accent-green)" }} onClick={() => { onDeleteSubject(s.id); setConfirmDeleteId(null); }}><Check size={13} /></button>
                  <button className="icon-btn tiny" onClick={() => setConfirmDeleteId(null)}><X size={13} /></button>
                </div>
              ) : (
                <button
                  className="icon-btn tiny"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                >
                  <Trash2 size={13} />
                </button>
              )
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: 14, borderTop: "1px solid var(--line)" }}>
        <div className="flex items-center" style={{ gap: 8, marginBottom: 10 }}>
          <div className="role-badge" style={{ background: user.isAdmin ? "var(--accent-verify)" : "var(--line)" }}>
            {user.isAdmin ? <ShieldCheck size={13} color="var(--ink)" /> : <GraduationCap size={13} color="var(--paper)" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{user.isAdmin ? "Teacher · full access" : "Student · study mode"}</div>
          </div>
        </div>
        {user.isAdmin && (
          <button className="btn-ghost" style={{ width: "100%", marginBottom: 8 }} onClick={onOpenBackup}>
            <DatabaseBackup size={14} /> Backup & restore
          </button>
        )}
        <button className="btn-ghost" style={{ width: "100%" }} onClick={onLogout}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </aside>
  );
}

/* ---------------- materials tab ---------------- */
function MaterialsTab({ subject, user }) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const raw = await sGet(`materials:${subject.id}`, true);
    setMaterials(safeJSON(raw, []));
    setLoading(false);
  }, [subject.id]);

  useEffect(() => { load(); }, [load]);

  const saveMaterials = async (list) => {
    setMaterials(list);
    await sSet(`materials:${subject.id}`, JSON.stringify(list), true);
  };

  const addMaterial = async (m) => {
    await saveMaterials([...materials, m]);
  };
  const removeMaterial = async (id) => {
    await saveMaterials(materials.filter((m) => m.id !== id));
    setConfirmDeleteId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <p style={{ color: "var(--ink-soft)", fontSize: 13, maxWidth: 520 }}>
          Everything generated in this app is built only from the material added here — nothing pulled from the open internet.
        </p>
        {user.isAdmin && (
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Upload size={15} /> Add material
          </button>
        )}
      </div>

      {loading && <LoadingRow label="Loading materials…" />}

      {!loading && materials.length === 0 && (
        <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
          <FileText size={28} color="var(--ink-soft)" />
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>
            {user.isAdmin ? "No material uploaded yet for this subject." : "Your teacher hasn't uploaded anything here yet."}
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {materials.map((m) => (
          <div className="card" key={m.id} style={{ padding: "14px 16px" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                {m.sourceType === "file" ? <ImageIcon size={16} color="var(--accent-teal)" /> : <FileText size={16} color="var(--accent-teal)" />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--paper)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div style={{ color: "var(--ink-soft)", fontSize: 11 }}>{new Date(m.addedAt).toLocaleDateString()} · {m.text.length.toLocaleString()} chars</div>
                </div>
              </div>
              {user.isAdmin && (
                confirmDeleteId === m.id ? (
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: "var(--accent-red)" }}>Remove?</span>
                    <button className="icon-btn tiny" style={{ color: "var(--accent-green)" }} onClick={() => removeMaterial(m.id)}><Check size={14} /></button>
                    <button className="icon-btn tiny" onClick={() => setConfirmDeleteId(null)}><X size={14} /></button>
                  </div>
                ) : (
                  <button className="icon-btn tiny" onClick={() => setConfirmDeleteId(m.id)}><Trash2 size={14} /></button>
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <AddMaterialModal
          onClose={() => setModalOpen(false)}
          onAdd={async (m) => { await addMaterial(m); setModalOpen(false); }}
        />
      )}
    </div>
  );
}

function AddMaterialModal({ onClose, onAdd }) {
  const [mode, setMode] = useState("text");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const submitText = async () => {
    if (!name.trim() || !text.trim()) return;
    await onAdd({ id: "mat_" + Date.now(), name: name.trim(), sourceType: "text", text: text.trim(), addedAt: Date.now() });
  };

  const submitFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1];
      const isPdf = file.type === "application/pdf";
      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } };

      const extracted = await callClaude({
        system: "You transcribe classroom material exactly as written. Output only the extracted text content, preserving headings, lists, and structure. No commentary, no markdown fences.",
        messages: [{ role: "user", content: [block, { type: "text", text: "Extract all text content from this material verbatim." }] }],
        maxTokens: 1000,
      });

      if (!extracted.trim()) throw new Error("Nothing could be read from this file.");

      await onAdd({
        id: "mat_" + Date.now(),
        name: name.trim() || file.name,
        sourceType: "file",
        text: extracted.trim(),
        addedAt: Date.now(),
      });
    } catch (e) {
      setError("Couldn't read that file. Try a clearer photo or paste the text instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} title="Add material" wide>
      <div className="segmented">
        <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>Paste text</button>
        <button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>Upload photo / PDF</button>
      </div>

      <label className="field-label" style={{ marginTop: 14 }}>Material name</label>
      <input className="input" placeholder="e.g. Ch. 4 Notes — Cell Respiration" value={name} onChange={(e) => setName(e.target.value)} />

      {mode === "text" ? (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>Paste the exact content</label>
          <textarea className="input" rows={8} placeholder="Paste notes, worksheet text, slide content…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={!name.trim() || !text.trim()} onClick={submitText}>
            <Check size={15} /> Add material
          </button>
        </>
      ) : (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>Photo of notes/worksheet, or a PDF</label>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="input" style={{ padding: 10 }} />
          {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}
          <button className="btn-primary" style={{ width: "100%", marginTop: 14 }} disabled={busy} onClick={submitFile}>
            {busy ? <><Loader2 size={15} className="spin" /> Reading…</> : <><Upload size={15} /> Extract & add</>}
          </button>
        </>
      )}
    </ModalShell>
  );
}

/* ---------------- shared: material context ---------------- */
async function getMaterialsContext(subjectId) {
  const raw = await sGet(`materials:${subjectId}`, true);
  const list = safeJSON(raw, []);
  if (!list.length) return null;
  const joined = list.map((m) => `--- ${m.name} ---\n${m.text}`).join("\n\n");
  return joined.slice(0, 9000);
}

function LoadingRow({ label }) {
  return (
    <div className="flex items-center" style={{ gap: 8, color: "var(--ink-soft)", fontSize: 13, padding: "10px 0" }}>
      <Loader2 size={15} className="spin" /> {label}
    </div>
  );
}

/* ---------------- summary / notes tab ---------------- */
function GeneratedTextTab({ subject, kind, title }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [reviewedAt, setReviewedAt] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const raw = await sGet(`${kind}:${subject.id}`, true);
      setContent(raw || "");
      const p = await getProgress(subject.id);
      setReviewedAt(kind === "summary" ? p.summaryReviewed : p.notesReviewed);
      setLoading(false);
    })();
  }, [subject.id, kind]);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const ctx = await getMaterialsContext(subject.id);
      if (!ctx) { setError("Add material first — there's nothing to build from yet."); setGenerating(false); return; }
      const prompt = kind === "summary"
        ? "Write a clear, well-organized summary of this material for a student reviewing before a test. Use short headed sections and concise bullet points. Plain text only, no markdown symbols."
        : "Turn this material into clean, well-structured study notes — organized by topic with clear headers and bullet points a student can scan quickly. Plain text only, no markdown symbols.";
      const out = await callClaude({
        system: "You write study content using ONLY the teacher-provided material given to you. Never add outside facts. If the material is incomplete on a point, note that rather than inventing detail.",
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\n${prompt}` }],
        maxTokens: 1000,
      });
      setContent(out.trim());
      await sSet(`${kind}:${subject.id}`, out.trim(), true);
    } catch (e) {
      setError("Something went wrong generating that. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkReviewed = async () => {
    await markReviewed(subject.id, kind);
    setReviewedAt(Date.now());
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <span className="stamp-chip"><Stamp size={12} /> Built only from your class material</span>
        <div className="flex items-center" style={{ gap: 8 }}>
          {content && (
            reviewedAt
              ? <span className="mastery-chip done"><Check size={12} /> Reviewed {new Date(reviewedAt).toLocaleDateString()}</span>
              : <button className="btn-ghost" onClick={handleMarkReviewed}><Check size={13} /> Mark as reviewed</button>
          )}
          <button className="btn-secondary" disabled={generating} onClick={generate}>
            {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><Sparkles size={14} /> {content ? `Regenerate ${title}` : `Generate ${title}`}</>}
          </button>
        </div>
      </div>
      {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}
      {loading && <LoadingRow label="Loading…" />}
      {!loading && !content && !error && (
        <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
          <BookOpen size={26} color="var(--ink-soft)" />
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>No {title.toLowerCase()} yet. Generate one from the uploaded material.</p>
        </div>
      )}
      {content && (
        <div className="card" style={{ padding: 22, whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--paper)", fontSize: 14.5 }}>
          {content}
        </div>
      )}
    </div>
  );
}

/* ---------------- flashcards tab ---------------- */
function FlashcardsTab({ subject }) {
  const [diff, setDiff] = useState("foundational");
  const [byDiff, setByDiff] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ flashcards: {} });

  const load = useCallback(async () => {
    setLoading(true);
    const obj = {};
    for (const d of DIFFICULTIES) {
      const raw = await sGet(`flashcards:${subject.id}:${d.id}`, true);
      obj[d.id] = safeJSON(raw, []);
    }
    setByDiff(obj);
    setProgress(await getProgress(subject.id));
    setIndex(0); setFlipped(false);
    setLoading(false);
  }, [subject.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setIndex(0); setFlipped(false); }, [diff]);

  const cards = byDiff[diff] || [];

  const generateMore = async () => {
    setGenerating(true);
    setError("");
    try {
      const ctx = await getMaterialsContext(subject.id);
      if (!ctx) { setError("Add material first — there's nothing to build from yet."); setGenerating(false); return; }
      const existing = cards.map((c) => c.front).join(" | ");
      const out = await callClaude({
        system: "You create flashcards using ONLY the given teacher material. Respond with ONLY valid JSON, no markdown fences, no commentary. Format: [{\"front\":\"...\",\"back\":\"...\",\"topic\":\"...\"}]. \"topic\" is a short 2-4 word unit/topic name from within the material (e.g. \"Cell Respiration\", \"Linear Equations\") — use the same exact topic name for cards on the same unit so they can be grouped.",
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\nCreate 6 new flashcards covering different parts of this material, at this difficulty: ${DIFF_PROMPTS[diff]} Avoid repeating these existing fronts: ${existing || "none"}. Front = concise question or term. Back = concise answer/definition. Tag each with the specific topic/unit it belongs to.` }],
        maxTokens: 1000,
      });
      const parsed = safeJSON(stripFence(out), []);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("empty");
      const withIds = parsed.map((c, i) => ({ id: "fc_" + Date.now() + "_" + i, front: c.front, back: c.back, topic: c.topic || "General" }));
      const updated = { ...byDiff, [diff]: [...cards, ...withIds] };
      setByDiff(updated);
      await sSet(`flashcards:${subject.id}:${diff}`, JSON.stringify(updated[diff]), true);
    } catch (e) {
      setError("Couldn't generate flashcards. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const card = cards[index];
  const masteredCount = cards.filter((c) => progress.flashcards?.[c.id]?.mastered).length;

  const rate = async (knewIt) => {
    if (!card) return;
    const p = await rateFlashcard(subject.id, card.id, knewIt, card.front);
    setProgress(p);
    if (index < cards.length - 1) { setIndex((i) => i + 1); setFlipped(false); }
  };

  return (
    <div>
      <div className="diff-row">
        {DIFFICULTIES.map((d) => (
          <button key={d.id} className={"diff-pill" + (diff === d.id ? " active" : "")} onClick={() => setDiff(d.id)}>
            {d.label}
          </button>
        ))}
      </div>
      <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: "10px 0 16px" }}>
        {DIFFICULTIES.find((d) => d.id === diff).desc}
      </p>

      <div className="flex items-center justify-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span className="stamp-chip"><Stamp size={12} /> {cards.length} card{cards.length !== 1 ? "s" : ""}</span>
          {cards.length > 0 && (
            <span className="mastery-chip"><Award size={12} /> {masteredCount}/{cards.length} mastered</span>
          )}
        </div>
        <button className="btn-secondary" disabled={generating} onClick={generateMore}>
          {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><Sparkles size={14} /> Generate 6 more</>}
        </button>
      </div>
      {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}
      {loading && <LoadingRow label="Loading flashcards…" />}

      {!loading && cards.length === 0 && !error && (
        <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
          <Layers size={26} color="var(--ink-soft)" />
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>No flashcards at this level yet. Generate a set from the uploaded material.</p>
        </div>
      )}

      {card && (
        <div className="flex flex-col items-center">
          <div className="flash-card" onClick={() => setFlipped((f) => !f)}>
            {progress.flashcards?.[card.id]?.mastered && (
              <span className="mastery-badge"><Award size={12} /> Mastered</span>
            )}
            <div className={"flash-inner" + (flipped ? " flipped" : "")}>
              <div className="flash-face front">
                <span className="flash-label">{card.topic ? card.topic : "Question"}</span>
                <p>{card.front}</p>
              </div>
              <div className="flash-face back">
                <span className="flash-label">Answer</span>
                <p>{card.back}</p>
              </div>
            </div>
          </div>
          {!flipped ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 10 }}>Tap card to flip</p>
          ) : (
            <div className="flex items-center" style={{ gap: 10, marginTop: 14 }}>
              <button className="btn-rate weak" onClick={() => rate(false)}><ThumbsDown size={14} /> Still learning</button>
              <button className="btn-rate strong" onClick={() => rate(true)}><ThumbsUp size={14} /> Got it</button>
            </div>
          )}
          <div className="flex items-center" style={{ gap: 14, marginTop: 14 }}>
            <button className="icon-btn" disabled={index === 0} onClick={() => { setIndex((i) => i - 1); setFlipped(false); }}><ChevronLeft size={18} /></button>
            <span style={{ color: "var(--ink-soft)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{index + 1} / {cards.length}</span>
            <button className="icon-btn" disabled={index === cards.length - 1} onClick={() => { setIndex((i) => i + 1); setFlipped(false); }}><ChevronRight size={18} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- practice tab ---------------- */
const DIFFICULTIES = [
  { id: "foundational", label: "Foundational", desc: "Core recall — build the basics" },
  { id: "standard", label: "Standard", desc: "Grade-level application" },
  { id: "challenge", label: "Challenge", desc: "Multi-step reasoning" },
  { id: "stateLevel", label: "State-Level", desc: "Florida B.E.S.T./FAST exam difficulty" },
];

const DIFF_PROMPTS = {
  foundational: "Foundational recall — definitions, basic facts, single-step recall directly stated in the material.",
  standard: "Standard grade-level application — requires applying a concept from the material, not just recalling it.",
  challenge: "Challenging multi-step reasoning that combines two or more ideas from the material.",
  stateLevel: "Florida B.E.S.T. Standards / FAST assessment difficulty — the rigorous, precisely worded style used on Florida's state test: longer question stems, application to an unfamiliar scenario rather than the exact classroom example, evidence-based reasoning, and answer choices that include plausible near-misses testing common misconceptions, not just one obviously wrong option.",
};

function PracticeTab({ subject }) {
  const [diff, setDiff] = useState("foundational");
  const [byDiff, setByDiff] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState({});
  const [grading, setGrading] = useState({});
  const [feedback, setFeedback] = useState({});
  const [progress, setProgress] = useState({ practice: {} });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const obj = {};
      for (const d of DIFFICULTIES) {
        const raw = await sGet(`practice:${subject.id}:${d.id}`, true);
        obj[d.id] = safeJSON(raw, []);
      }
      setByDiff(obj);
      setProgress(await getProgress(subject.id));
      setLoading(false);
    })();
  }, [subject.id]);

  const questions = byDiff[diff] || [];

  const generateMore = async () => {
    setGenerating(true);
    setError("");
    try {
      const ctx = await getMaterialsContext(subject.id);
      if (!ctx) { setError("Add material first — there's nothing to build from yet."); setGenerating(false); return; }
      let knownTopics = [];
      for (const d of DIFFICULTIES) {
        const raw = await sGet(`flashcards:${subject.id}:${d.id}`, true);
        knownTopics.push(...safeJSON(raw, []).map((c) => c.topic).filter(Boolean));
      }
      knownTopics = [...new Set(knownTopics)];
      const out = await callClaude({
        system: "You write practice questions using ONLY the given teacher material. Respond with ONLY valid JSON, no markdown fences. Format: [{\"type\":\"mcq\",\"question\":\"...\",\"options\":[\"a\",\"b\",\"c\",\"d\"],\"correctIndex\":0,\"explanation\":\"...\",\"topic\":\"...\"}, {\"type\":\"short\",\"question\":\"...\",\"sampleAnswer\":\"...\",\"rubric\":\"...\",\"topic\":\"...\"}]. \"topic\" is a short 2-4 word unit/topic name from within the material (e.g. \"Cell Respiration\").",
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\nWrite 4 practice questions (mix of \"mcq\" and \"short\" types) at this difficulty: ${DIFF_PROMPTS[diff]}. Tag each with the specific topic/unit it belongs to.${knownTopics.length ? ` Reuse these exact topic names where they fit: ${knownTopics.join(", ")}.` : ""}` }],
        maxTokens: 1000,
      });
      const parsed = safeJSON(stripFence(out), []);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("empty");
      const withIds = parsed.map((q, i) => ({ id: "q_" + Date.now() + "_" + i, ...q, topic: q.topic || "General" }));
      const updated = { ...byDiff, [diff]: [...(byDiff[diff] || []), ...withIds] };
      setByDiff(updated);
      await sSet(`practice:${subject.id}:${diff}`, JSON.stringify(updated[diff]), true);
    } catch (e) {
      setError("Couldn't generate questions. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const chooseOption = async (qid, idx, correctIndex, questionText) => {
    setAnswers((a) => ({ ...a, [qid]: idx }));
    const p = await recordPracticeAttempt(subject.id, diff, qid, idx === correctIndex, questionText);
    setProgress(p);
  };

  const gradeShort = async (q, response) => {
    setGrading((g) => ({ ...g, [q.id]: true }));
    try {
      const out = await callClaude({
        system: "You are a supportive tutor grading a student's short answer. Never just say right or wrong — explain briefly what's solid and what's missing, guiding them toward the full answer without simply restating it if they're off track. Keep it to 3-4 sentences.",
        messages: [{ role: "user", content: `Question: ${q.question}\nExpected idea: ${q.sampleAnswer}\nRubric: ${q.rubric || "n/a"}\nStudent's answer: ${response}\n\nGive feedback.` }],
        maxTokens: 1000,
      });
      setFeedback((f) => ({ ...f, [q.id]: out.trim() }));
    } catch (e) {
      setFeedback((f) => ({ ...f, [q.id]: "Couldn't grade that just now — try again." }));
    } finally {
      setGrading((g) => ({ ...g, [q.id]: false }));
    }
  };

  const selfMarkShort = async (q, gotIt) => {
    const p = await recordPracticeAttempt(subject.id, diff, q.id, gotIt, q.question);
    setProgress(p);
  };

  const stats = diffStats(progress, diff);

  return (
    <div>
      <div className="diff-row">
        {DIFFICULTIES.map((d) => {
          const s = diffStats(progress, d.id);
          return (
            <button key={d.id} className={"diff-pill" + (diff === d.id ? " active" : "")} onClick={() => setDiff(d.id)}>
              {d.label}
              {s.attempted > 0 && <span className="diff-dot" style={{ background: s.accuracy >= 80 ? "var(--accent-green)" : s.accuracy >= 50 ? "var(--accent-verify)" : "var(--accent-red)" }} />}
            </button>
          );
        })}
      </div>
      <p style={{ color: "var(--ink-soft)", fontSize: 13, margin: "10px 0 16px" }}>
        {DIFFICULTIES.find((d) => d.id === diff).desc}
      </p>

      <div className="flex items-center justify-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span className="stamp-chip"><Stamp size={12} /> {questions.length} question{questions.length !== 1 ? "s" : ""}</span>
          {stats.attempted > 0 && (
            <span className="mastery-chip"><TrendingUp size={12} /> {stats.accuracy}% accuracy · {stats.mastered} mastered</span>
          )}
        </div>
        <button className="btn-secondary" disabled={generating} onClick={generateMore}>
          {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><Sparkles size={14} /> Generate 4 more</>}
        </button>
      </div>
      {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}
      {loading && <LoadingRow label="Loading questions…" />}

      {!loading && questions.length === 0 && !error && (
        <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
          <GraduationCap size={26} color="var(--ink-soft)" />
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>No questions at this level yet.</p>
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {questions.map((q, i) => {
          const qProgress = (progress.practice || {})[diff]?.[q.id];
          return (
          <div className="card" key={q.id} style={{ padding: 18 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-teal)", letterSpacing: 1 }}>
                Q{i + 1} · {q.type === "mcq" ? "Multiple choice" : "Short answer"}{q.topic ? ` · ${q.topic}` : ""}
              </div>
              {qProgress?.streak >= 2 && <span className="mastery-chip done"><Award size={11} /> Mastered</span>}
            </div>
            <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 12 }}>{q.question}</p>

            {q.type === "mcq" ? (
              <div style={{ display: "grid", gap: 8 }}>
                {q.options.map((opt, idx) => {
                  const chosen = answers[q.id];
                  const isChosen = chosen === idx;
                  const revealed = chosen !== undefined;
                  const isCorrect = idx === q.correctIndex;
                  let cls = "mcq-option";
                  if (revealed && isChosen) cls += isCorrect ? " correct" : " incorrect";
                  else if (revealed && isCorrect) cls += " correct-dim";
                  return (
                    <button key={idx} className={cls} disabled={revealed} onClick={() => chooseOption(q.id, idx, q.correctIndex, q.question)}>
                      {opt}
                    </button>
                  );
                })}
                {answers[q.id] !== undefined && (
                  <div className="explain-box">{q.explanation}</div>
                )}
              </div>
            ) : (
              <ShortAnswerBlock q={q} onSubmit={gradeShort} grading={!!grading[q.id]} feedback={feedback[q.id]} onSelfMark={selfMarkShort} />
            )}
          </div>
        );})}
      </div>
    </div>
  );
}

function ShortAnswerBlock({ q, onSubmit, grading, feedback, onSelfMark }) {
  const [val, setVal] = useState("");
  const [sent, setSent] = useState(false);
  const [marked, setMarked] = useState(false);
  return (
    <div>
      <textarea className="input" rows={3} placeholder="Type your answer…" value={val} onChange={(e) => setVal(e.target.value)} disabled={sent && grading} />
      <button className="btn-secondary" style={{ marginTop: 8 }} disabled={!val.trim() || grading} onClick={() => { setSent(true); onSubmit(q, val); }}>
        {grading ? <><Loader2 size={13} className="spin" /> Checking…</> : "Check my answer"}
      </button>
      {feedback && <div className="explain-box" style={{ marginTop: 10 }}>{feedback}</div>}
      {feedback && !marked && (
        <div className="flex items-center" style={{ gap: 10, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Be honest — how'd you do?</span>
          <button className="btn-rate weak small" onClick={() => { onSelfMark(q, false); setMarked(true); }}><ThumbsDown size={12} /> Missed it</button>
          <button className="btn-rate strong small" onClick={() => { onSelfMark(q, true); setMarked(true); }}><ThumbsUp size={12} /> Nailed it</button>
        </div>
      )}
      {marked && <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 8 }}>Saved to your progress.</div>}
    </div>
  );
}

/* ---------------- focus tab ---------------- */
function FocusTab({ subject }) {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);
  const [cards, setCards] = useState([]);
  const [questionsByDiff, setQuestionsByDiff] = useState({});
  const [missedTestQuestions, setMissedTestQuestions] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [answers, setAnswers] = useState({});
  const [grading, setGrading] = useState({});
  const [feedback, setFeedback] = useState({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getProgress(subject.id);
    let allCards = [];
    const qByDiff = {};
    for (const d of DIFFICULTIES) {
      const cardsRaw = await sGet(`flashcards:${subject.id}:${d.id}`, true);
      allCards.push(...safeJSON(cardsRaw, []).map((c) => ({ ...c, difficulty: d.id })));
      const raw = await sGet(`practice:${subject.id}:${d.id}`, true);
      qByDiff[d.id] = safeJSON(raw, []);
    }
    const missedRaw = await sGet(`missedTestQuestions:${subject.id}`, false);
    setMissedTestQuestions(safeJSON(missedRaw, []));
    setProgress(p);
    setCards(allCards);
    setQuestionsByDiff(qByDiff);
    setBreakdown(computeTopicBreakdown(allCards, qByDiff, p));
    setCardIndex(0); setFlipped(false); setAnswers({});
    setLoading(false);
  }, [subject.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingRow label="Finding your weak spots…" />;

  const weakTopics = breakdown.filter((t) => t.totalItems > 0 && (!t.started || t.score < 70)).slice(0, 6).map((t) => t.topic);
  const weakCards = cards.filter((c) => weakTopics.includes(c.topic || "General") && !(progress.flashcards || {})[c.id]?.mastered);

  const weakQuestions = [];
  for (const diffId of Object.keys(questionsByDiff)) {
    for (const q of questionsByDiff[diffId] || []) {
      if (!weakTopics.includes(q.topic || "General")) continue;
      const pq = (progress.practice || {})[diffId]?.[q.id];
      if (!pq || pq.streak === 0) weakQuestions.push({ ...q, _diff: diffId });
    }
  }
  // Questions missed on a practice test show up here regardless of topic-wide mastery — a miss is a miss.
  for (const q of missedTestQuestions) {
    const pq = (progress.practice || {})[q.difficulty]?.[q.id];
    if (!pq || pq.streak === 0) weakQuestions.push({ ...q, _diff: q.difficulty });
  }

  if (weakTopics.length === 0 && weakQuestions.length === 0) {
    return (
      <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
        <Target size={26} color="var(--ink-soft)" />
        <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>
          {breakdown.length === 0
            ? "Do some flashcards or practice questions first — this tab will find your weak spots once there's activity to learn from."
            : "No clear weak spots right now — nice work. Keep studying to keep this fresh."}
        </p>
      </div>
    );
  }

  const rateWeakCard = async (card, knewIt) => {
    const p = await rateFlashcard(subject.id, card.id, knewIt, card.front);
    setProgress(p);
    setBreakdown(computeTopicBreakdown(cards, questionsByDiff, p));
    if (cardIndex < weakCards.length - 1) { setCardIndex((i) => i + 1); setFlipped(false); }
  };

  const chooseWeakOption = async (q, idx) => {
    setAnswers((a) => ({ ...a, [q.id]: idx }));
    const p = await recordPracticeAttempt(subject.id, q._diff, q.id, idx === q.correctIndex, q.question);
    setProgress(p);
    setBreakdown(computeTopicBreakdown(cards, questionsByDiff, p));
  };

  const gradeWeakShort = async (q, response) => {
    setGrading((g) => ({ ...g, [q.id]: true }));
    try {
      const out = await callClaude({
        system: "You are a supportive tutor grading a student's short answer. Never just say right or wrong — explain briefly what's solid and what's missing. Keep it to 3-4 sentences.",
        messages: [{ role: "user", content: `Question: ${q.question}\nExpected idea: ${q.sampleAnswer}\nRubric: ${q.rubric || "n/a"}\nStudent's answer: ${response}\n\nGive feedback.` }],
        maxTokens: 1000,
      });
      setFeedback((f) => ({ ...f, [q.id]: out.trim() }));
    } catch (e) {
      setFeedback((f) => ({ ...f, [q.id]: "Couldn't grade that just now — try again." }));
    } finally {
      setGrading((g) => ({ ...g, [q.id]: false }));
    }
  };

  const selfMarkWeak = async (q, gotIt) => {
    const p = await recordPracticeAttempt(subject.id, q._diff, q.id, gotIt, q.question);
    setProgress(p);
    setBreakdown(computeTopicBreakdown(cards, questionsByDiff, p));
  };

  const generateMoreFocus = async () => {
    setGenerating(true);
    setError("");
    try {
      const ctx = await getMaterialsContext(subject.id);
      if (!ctx) { setError("Add material first."); setGenerating(false); return; }
      const out = await callClaude({
        system: "You create flashcards using ONLY the given teacher material. Respond with ONLY valid JSON, no markdown fences. Format: [{\"front\":\"...\",\"back\":\"...\",\"topic\":\"...\"}].",
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\nCreate 6 flashcards focused specifically on these weak topics: ${weakTopics.join(", ")}. Reuse these exact topic names.` }],
        maxTokens: 1000,
      });
      const parsed = safeJSON(stripFence(out), []);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("empty");
      const withIds = parsed.map((c, i) => ({ id: "fc_" + Date.now() + "_" + i, front: c.front, back: c.back, topic: c.topic || weakTopics[0], difficulty: "standard" }));
      const updated = [...cards, ...withIds];
      const standardTierCards = updated.filter((c) => c.difficulty === "standard");
      await sSet(`flashcards:${subject.id}:standard`, JSON.stringify(standardTierCards), true);
      setCards(updated);
      setBreakdown(computeTopicBreakdown(updated, questionsByDiff, progress));
    } catch (e) {
      setError("Couldn't generate more focus material. Try again.");
    } finally {
      setGenerating(false);
    }
  };

  const card = weakCards[cardIndex];

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <span className="stamp-chip"><Target size={12} /> {weakTopics.length} weak topic{weakTopics.length !== 1 ? "s" : ""}</span>
        <button className="btn-secondary" disabled={generating} onClick={generateMoreFocus}>
          {generating ? <><Loader2 size={14} className="spin" /> Generating…</> : <><Sparkles size={14} /> More on weak spots</>}
        </button>
      </div>
      {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}

      <div className="flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {weakTopics.map((t) => <span key={t} className="mastery-chip" style={{ color: "var(--accent-red)", borderColor: "var(--accent-red)" }}>{t}</span>)}
      </div>

      {weakCards.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600, display: "block", marginBottom: 12 }}>Review these flashcards</span>
          {card && (
            <div className="flex flex-col items-center">
              <div className="flash-card" onClick={() => setFlipped((f) => !f)}>
                <div className={"flash-inner" + (flipped ? " flipped" : "")}>
                  <div className="flash-face front">
                    <span className="flash-label">{card.topic || "Question"}</span>
                    <p>{card.front}</p>
                  </div>
                  <div className="flash-face back">
                    <span className="flash-label">Answer</span>
                    <p>{card.back}</p>
                  </div>
                </div>
              </div>
              {!flipped ? (
                <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 10 }}>Tap card to flip</p>
              ) : (
                <div className="flex items-center" style={{ gap: 10, marginTop: 14 }}>
                  <button className="btn-rate weak" onClick={() => rateWeakCard(card, false)}><ThumbsDown size={14} /> Still learning</button>
                  <button className="btn-rate strong" onClick={() => rateWeakCard(card, true)}><ThumbsUp size={14} /> Got it</button>
                </div>
              )}
              <div style={{ color: "var(--ink-soft)", fontSize: 12, fontFamily: "var(--font-mono)", marginTop: 10 }}>{cardIndex + 1} / {weakCards.length}</div>
            </div>
          )}
        </div>
      )}

      {weakQuestions.length > 0 && (
        <div>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600, display: "block", marginBottom: 12 }}>Retry these questions</span>
          <div style={{ display: "grid", gap: 14 }}>
            {weakQuestions.map((q) => (
              <div className="card" key={q.id} style={{ padding: 18 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-teal)", marginBottom: 6, letterSpacing: 1 }}>
                  {q.topic || "General"} · {(DIFFICULTIES.find((d) => d.id === q._diff) || {}).label}{q._source === "test" ? " · Missed on a test" : ""}
                </div>
                <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 12 }}>{q.question}</p>
                {q.type === "mcq" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {q.options.map((opt, idx) => {
                      const chosen = answers[q.id];
                      const isChosen = chosen === idx;
                      const revealed = chosen !== undefined;
                      const isCorrect = idx === q.correctIndex;
                      let cls = "mcq-option";
                      if (revealed && isChosen) cls += isCorrect ? " correct" : " incorrect";
                      else if (revealed && isCorrect) cls += " correct-dim";
                      return (
                        <button key={idx} className={cls} disabled={revealed} onClick={() => chooseWeakOption(q, idx)}>
                          {opt}
                        </button>
                      );
                    })}
                    {answers[q.id] !== undefined && <div className="explain-box">{q.explanation}</div>}
                  </div>
                ) : (
                  <ShortAnswerBlock q={q} onSubmit={gradeWeakShort} grading={!!grading[q.id]} feedback={feedback[q.id]} onSelfMark={selfMarkWeak} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {weakCards.length === 0 && weakQuestions.length === 0 && (
        <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
          <Check size={26} color="var(--accent-green)" />
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 10 }}>You're caught up on your weak spots for now. Generate more above or check back after more practice.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- practice test tab ---------------- */
const DAILY_TEST_LIMIT = 5;

async function getTestDailyCount(subjectId) {
  const p = await getProgress(subjectId);
  const today = todayStr();
  if (!p.testsToday || p.testsToday.date !== today) return 0;
  return p.testsToday.count;
}
async function incrementTestDaily(subjectId) {
  const p = await getProgress(subjectId);
  const today = todayStr();
  if (!p.testsToday || p.testsToday.date !== today) p.testsToday = { date: today, count: 0 };
  p.testsToday.count += 1;
  await saveProgress(subjectId, p);
  return p.testsToday.count;
}

function PracticeTestTab({ subject }) {
  const [phase, setPhase] = useState("start"); // start | generating | taking | grading | results
  const [test, setTest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [dailyCount, setDailyCount] = useState(0);
  const [pastTests, setPastTests] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef(null);

  const refreshMeta = useCallback(async () => {
    setLoading(true);
    setDailyCount(await getTestDailyCount(subject.id));
    const raw = await sGet(`tests:${subject.id}`, false);
    setPastTests(safeJSON(raw, []));
    const activeRaw = await sGet(`activeTest:${subject.id}`, false);
    const active = safeJSON(activeRaw, null);
    if (active && active.test && active.test.questions?.length) {
      setTest(active.test);
      setAnswers(active.answers || {});
      setPhase("taking");
    } else {
      setTest(null);
      setAnswers({});
      setPhase("start");
    }
    setResults(null);
    setLoading(false);
  }, [subject.id]);

  useEffect(() => { refreshMeta(); }, [subject.id, refreshMeta]);

  const persistActiveTest = (t, a) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      sSet(`activeTest:${subject.id}`, JSON.stringify({ test: t, answers: a }), false);
    }, 500);
  };

  const generateTest = async () => {
    setError("");
    if (dailyCount >= DAILY_TEST_LIMIT) return;
    setPhase("generating");
    try {
      const ctx = await getMaterialsContext(subject.id);
      if (!ctx) { setError("Add material first — there's nothing to build a test from yet."); setPhase("start"); return; }
      const usedRaw = await sGet(`usedTestQuestions:${subject.id}`, false);
      const used = safeJSON(usedRaw, []).slice(0, 40);

      const batchSchema = "Respond with ONLY valid JSON, no markdown fences. Format: [{\"type\":\"mcq\",\"question\":\"...\",\"options\":[\"a\",\"b\",\"c\",\"d\"],\"correctIndex\":0,\"explanation\":\"...\",\"topic\":\"...\",\"difficulty\":\"foundational|standard|challenge|stateLevel\"}, {\"type\":\"short\",\"question\":\"...\",\"sampleAnswer\":\"...\",\"rubric\":\"...\",\"topic\":\"...\",\"difficulty\":\"foundational|standard|challenge|stateLevel\"}]";

      const batch1 = await callClaude({
        system: `You write full-length test questions using ONLY the given teacher material. ${batchSchema}`,
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\nWrite 5 test questions (mix of mcq and short), difficulty foundational-to-standard, covering different topics across the material. Never repeat any of these already-used questions: ${used.length ? used.join(" | ") : "none"}.` }],
        maxTokens: 1000,
      });
      const batch2 = await callClaude({
        system: `You write full-length test questions using ONLY the given teacher material. ${batchSchema}`,
        messages: [{ role: "user", content: `TEACHER MATERIAL:\n${ctx}\n\nWrite 5 test questions (mix of mcq and short), covering different topics across the material than a typical easy set would, at this difficulty: ${DIFF_PROMPTS.challenge} Mix in some at this difficulty too: ${DIFF_PROMPTS.stateLevel} Never repeat any of these already-used questions: ${used.length ? used.join(" | ") : "none"}.` }],
        maxTokens: 1000,
      });

      const p1 = safeJSON(stripFence(batch1), []);
      const p2 = safeJSON(stripFence(batch2), []);
      const combined = [...p1, ...p2];
      if (!combined.length) throw new Error("empty");

      const questions = combined
        .map((q, i) => ({ id: "tq_" + Date.now() + "_" + i, ...q, topic: q.topic || "General", difficulty: DIFFICULTIES.some((d) => d.id === q.difficulty) ? q.difficulty : "standard" }))
        .sort(() => Math.random() - 0.5);

      const newUsed = [...questions.map((q) => q.question), ...used].slice(0, 60);
      await sSet(`usedTestQuestions:${subject.id}`, JSON.stringify(newUsed), false);

      const newTest = { id: "test_" + Date.now(), createdAt: Date.now(), questions };
      setTest(newTest);
      setAnswers({});
      setPhase("taking");
      await sSet(`activeTest:${subject.id}`, JSON.stringify({ test: newTest, answers: {} }), false);
    } catch (e) {
      setError("Couldn't generate the test. Try again.");
      setPhase("start");
    }
  };

  const setAnswer = (qid, val) => {
    setAnswers((a) => {
      const next = { ...a, [qid]: val };
      persistActiveTest(test, next);
      return next;
    });
  };

  const abandonTest = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await sDelete(`activeTest:${subject.id}`, false).catch(() => {});
    setTest(null);
    setAnswers({});
    setPhase("start");
  };

  const submitTest = async () => {
    setPhase("grading");
    try {
      const mcqs = test.questions.filter((q) => q.type === "mcq");
      const shorts = test.questions.filter((q) => q.type === "short");

      const mcqResults = mcqs.map((q) => ({ q, correct: answers[q.id] === q.correctIndex }));

      let shortResults = [];
      if (shorts.length) {
        const gradingInput = shorts.map((q) => ({ id: q.id, question: q.question, expected: q.sampleAnswer, rubric: q.rubric || "", studentAnswer: answers[q.id] || "(left blank)" }));
        const out = await callClaude({
          system: "You are a supportive tutor grading short-answer test responses. For each item, decide if the student's answer captures the core idea and give 1-2 sentences of feedback. Respond with ONLY valid JSON, no markdown fences. Format: [{\"id\":\"...\",\"correct\":true,\"feedback\":\"...\"}]",
          messages: [{ role: "user", content: JSON.stringify(gradingInput) }],
          maxTokens: 1000,
        });
        const graded = safeJSON(stripFence(out), []);
        shortResults = shorts.map((q) => {
          const g = graded.find((x) => x.id === q.id) || { correct: false, feedback: "Couldn't grade this one." };
          return { q, correct: !!g.correct, feedback: g.feedback };
        });
      }

      const allResults = [...mcqResults, ...shortResults];
      for (const r of allResults) {
        await recordPracticeAttempt(subject.id, r.q.difficulty, r.q.id, r.correct, r.q.question);
      }
      const correctCount = allResults.filter((r) => r.correct).length;
      const total = allResults.length;
      const pct = Math.round((correctCount / total) * 100);

      const missed = allResults.filter((r) => !r.correct).map((r) => ({ ...r.q, _source: "test", missedAt: Date.now() }));
      if (missed.length) {
        const missedRaw = await sGet(`missedTestQuestions:${subject.id}`, false);
        const existingMissed = safeJSON(missedRaw, []);
        const merged = [...missed, ...existingMissed.filter((m) => !missed.some((n) => n.id === m.id))].slice(0, 60);
        await sSet(`missedTestQuestions:${subject.id}`, JSON.stringify(merged), false);
      }

      const p = await getProgress(subject.id);
      logEvent(p, { type: "test", label: `Completed a practice test — ${correctCount}/${total} (${pct}%)` });
      await saveProgress(subject.id, p);

      const newCount = await incrementTestDaily(subject.id);
      setDailyCount(newCount);

      const summary = { id: test.id, createdAt: test.createdAt, correctCount, total, pct };
      const updatedPast = [summary, ...pastTests].slice(0, 20);
      await sSet(`tests:${subject.id}`, JSON.stringify(updatedPast), false);
      setPastTests(updatedPast);

      await sDelete(`activeTest:${subject.id}`, false).catch(() => {});

      setResults({ allResults, correctCount, total, pct });
      setPhase("results");
    } catch (e) {
      setError("Something went wrong grading the test. Your answers are still here — try submitting again.");
      setPhase("taking");
    }
  };

  const answeredCount = test ? test.questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "").length : 0;

  if (loading) return <LoadingRow label="Loading…" />;

  return (
    <div>
      {phase === "start" && (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <span className="stamp-chip"><ClipboardCheck size={12} /> Full-length, mixed difficulty</span>
            <span className="mastery-chip"><Clock size={12} /> {dailyCount}/{DAILY_TEST_LIMIT} used today</span>
          </div>
          {error && <div className="error-line"><AlertCircle size={13} /> {error}</div>}
          <div className="card dashed" style={{ padding: 32, textAlign: "center" }}>
            <ClipboardCheck size={28} color="var(--ink-soft)" />
            <p style={{ color: "var(--paper)", fontSize: 15, marginTop: 12, fontWeight: 600 }}>10-question practice test</p>
            <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 6, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
              A mix of easy-to-hard questions across everything in this subject. Every test is freshly generated — no repeats from your last few.
            </p>
            {dailyCount >= DAILY_TEST_LIMIT ? (
              <p style={{ color: "var(--accent-red)", fontSize: 13, marginTop: 16 }}>You've used all {DAILY_TEST_LIMIT} tests for today — come back tomorrow.</p>
            ) : (
              <button className="btn-primary" style={{ marginTop: 18 }} onClick={generateTest}>
                <Sparkles size={15} /> Start a practice test
              </button>
            )}
          </div>

          {pastTests.length > 0 && (
            <div className="card" style={{ padding: 18, marginTop: 18 }}>
              <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Past tests</span>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {pastTests.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                    <span style={{ color: "var(--ink-soft)" }}>{new Date(t.createdAt).toLocaleDateString()}</span>
                    <span style={{ color: t.pct >= 80 ? "var(--accent-green)" : t.pct >= 50 ? "var(--accent-verify)" : "var(--accent-red)", fontFamily: "var(--font-mono)" }}>{t.correctCount}/{t.total} · {t.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "generating" && <LoadingRow label="Building your test from the material…" />}

      {phase === "taking" && test && (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <span className="stamp-chip"><ClipboardCheck size={12} /> {answeredCount}/{test.questions.length} answered</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>Auto-saves as you go</span>
            </div>
            <button className="btn-ghost" onClick={abandonTest}>Abandon test</button>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {test.questions.map((q, i) => (
              <div className="card" key={q.id} style={{ padding: 18 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-teal)", marginBottom: 6, letterSpacing: 1 }}>
                  Q{i + 1} · {q.topic} · {(DIFFICULTIES.find((d) => d.id === q.difficulty) || {}).label}
                </div>
                <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 12 }}>{q.question}</p>
                {q.type === "mcq" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {q.options.map((opt, idx) => (
                      <button key={idx} className={"mcq-option" + (answers[q.id] === idx ? " selected" : "")} onClick={() => setAnswer(q.id, idx)}>
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea className="input" rows={3} placeholder="Type your answer…" value={answers[q.id] || ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          <button className="btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={submitTest}>
            <Check size={15} /> Submit test
          </button>
        </div>
      )}

      {phase === "grading" && <LoadingRow label="Grading your test…" />}

      {phase === "results" && results && (
        <div>
          <div className="card streak-card" style={{ marginBottom: 18 }}>
            <ClipboardCheck size={26} color={results.pct >= 80 ? "var(--accent-green)" : results.pct >= 50 ? "var(--accent-verify)" : "var(--accent-red)"} />
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--paper)" }}>{results.correctCount}/{results.total} · {results.pct}%</div>
              <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Saved to your progress and topic breakdown</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            {results.allResults.map((r, i) => (
              <div className="card" key={r.q.id} style={{ padding: 18 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-teal)", letterSpacing: 1 }}>Q{i + 1} · {r.q.topic}</div>
                  <span className={"mastery-chip" + (r.correct ? " done" : "")} style={!r.correct ? { color: "var(--accent-red)", borderColor: "var(--accent-red)" } : {}}>{r.correct ? "Correct" : "Missed"}</span>
                </div>
                <p style={{ color: "var(--paper)", fontSize: 15, marginBottom: 8 }}>{r.q.question}</p>
                <div className="explain-box">{r.q.type === "mcq" ? r.q.explanation : r.feedback}</div>
              </div>
            ))}
          </div>
          <button className="btn-secondary" style={{ width: "100%", marginTop: 18 }} onClick={() => { setPhase("start"); setTest(null); setResults(null); }}>
            {dailyCount >= DAILY_TEST_LIMIT ? "Back to practice tests" : "Take another test"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- tutor tab ---------------- */
function TutorTab({ subject }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const raw = await sGet(`chat:${subject.id}`, false);
      setMessages(safeJSON(raw, []));
      setLoading(false);
    })();
  }, [subject.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const question = input.trim();
    const userMsg = { role: "user", content: question };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    recordTutorMessage(subject.id, question);
    try {
      const ctx = await getMaterialsContext(subject.id);
      const system = `You are a patient Socratic tutor for a student studying "${subject.name}". You only know what's in the teacher's material below — never introduce outside facts.
${ctx ? `TEACHER MATERIAL:\n${ctx}` : "No material has been uploaded yet — tell the student to ask their teacher to upload it, but still help them think through the question generally."}

Rules:
- Never give the final answer immediately. Ask a guiding question or point to the relevant concept first.
- Give hints step by step. Let the student attempt each step before revealing the next.
- Only state the final answer outright if the student has made a genuine attempt and asks you to confirm, or after 3+ back-and-forth exchanges on the same question.
- Keep responses short (3-6 sentences) and encouraging.`;
      const apiMessages = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const out = await callClaude({ system, messages: apiMessages, maxTokens: 1000 });
      const updated = [...nextMessages, { role: "assistant", content: out.trim(), rated: false }];
      setMessages(updated);
      await sSet(`chat:${subject.id}`, JSON.stringify(updated), false);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't respond just then — try asking again." }]);
    } finally {
      setSending(false);
    }
  };

  const rateMessage = async (index, helpful) => {
    const updated = messages.map((m, i) => i === index ? { ...m, rated: true, helpful } : m);
    setMessages(updated);
    await sSet(`chat:${subject.id}`, JSON.stringify(updated), false);
    await rateTutorHelpfulness(subject.id, helpful);
  };

  const clearChat = async () => {
    setMessages([]);
    await sDelete(`chat:${subject.id}`, false);
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 210px)", minHeight: 420 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span className="stamp-chip"><Brain size={12} /> Guides step-by-step, never hands you the answer</span>
        {messages.length > 0 && <button className="btn-ghost" onClick={clearChat}>Clear chat</button>}
      </div>
      <div className="chat-scroll">
        {loading && <LoadingRow label="Loading conversation…" />}
        {!loading && messages.length === 0 && (
          <div className="card dashed" style={{ padding: 28, textAlign: "center" }}>
            <MessageCircle size={24} color="var(--ink-soft)" />
            <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 8 }}>
              Ask about anything from {subject.name}. I'll walk you through it instead of just giving the answer.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"bubble-row" + (m.role === "user" ? " user" : "")}>
            <div style={{ maxWidth: "78%" }}>
              <div className={"bubble" + (m.role === "user" ? " user" : "")}>{m.content}</div>
              {m.role === "assistant" && (
                m.rated ? (
                  <div className="rated-note">{m.helpful ? "Marked helpful" : "Noted — keep asking"}</div>
                ) : (
                  <div className="flex items-center" style={{ gap: 8, marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>Did that help?</span>
                    <button className="btn-rate weak small" onClick={() => rateMessage(i, false)}><ThumbsDown size={11} /></button>
                    <button className="btn-rate strong small" onClick={() => rateMessage(i, true)}><ThumbsUp size={11} /></button>
                  </div>
                )
              )}
            </div>
          </div>
        ))}
        {sending && <div className="bubble-row"><div className="bubble"><Loader2 size={14} className="spin" /></div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="input"
          placeholder="Ask a question about this subject…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
        />
        <button className="btn-primary" style={{ padding: "10px 16px" }} disabled={!input.trim() || sending} onClick={send}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- progress tab ---------------- */
function ProgressTab({ subject }) {
  const [progress, setProgress] = useState(null);
  const [cardCount, setCardCount] = useState(0);
  const [cardsByDiff, setCardsByDiff] = useState([]);
  const [topicBreakdown, setTopicBreakdown] = useState([]);
  const [streak, setStreak] = useState({ current: 0, longest: 0 });
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(15);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const p = await getProgress(subject.id);
      let cards = [];
      const questionsByDiff = {};
      for (const d of DIFFICULTIES) {
        const cardsRaw = await sGet(`flashcards:${subject.id}:${d.id}`, true);
        cards.push(...safeJSON(cardsRaw, []).map((c) => ({ ...c, difficulty: d.id })));
        const raw = await sGet(`practice:${subject.id}:${d.id}`, true);
        questionsByDiff[d.id] = safeJSON(raw, []);
      }
      setProgress(p);
      setCardCount(cards.length);
      setCardsByDiff(cards);
      setTopicBreakdown(computeTopicBreakdown(cards, questionsByDiff, p));
      setStreak(await getStreak());
      setVisible(15);
      setLoading(false);
    })();
  }, [subject.id]);

  if (loading || !progress) return <LoadingRow label="Loading your progress…" />;

  const masteredCards = cardsByDiff.filter((c) => progress.flashcards?.[c.id]?.mastered).length;
  const cardPct = cardCount ? Math.round((masteredCards / cardCount) * 100) : 0;
  const history = progress.history || [];
  const groups = groupHistoryByDate(history.slice(0, visible));

  return (
    <div>
      <div className="card streak-card">
        <Flame size={26} color="var(--accent-verify)" />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--paper)" }}>{streak.current} day{streak.current === 1 ? "" : "s"}</div>
          <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Current study streak · longest {streak.longest} day{streak.longest === 1 ? "" : "s"}</div>
        </div>
      </div>

      {topicBreakdown.length > 0 && (
        <div className="card" style={{ padding: 18, marginTop: 18 }}>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Focus areas by topic</span>
          <p style={{ color: "var(--ink-soft)", fontSize: 12.5, marginTop: 4, marginBottom: 14 }}>
            Weakest topics first — this is exactly what to study next.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {topicBreakdown.map((t) => (
              <TopicRow key={t.topic} t={t} />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Summary & Notes</span>
          </div>
          <div className="flex items-center" style={{ gap: 18 }}>
            <ReviewPip label="Summary" done={!!progress.summaryReviewed} />
            <ReviewPip label="Notes" done={!!progress.notesReviewed} />
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Flashcards</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-soft)" }}>{masteredCards}/{cardCount} mastered</span>
          </div>
          <div className="progress-track" style={{ marginBottom: 14 }}><div className="progress-fill" style={{ width: `${cardPct}%`, background: "var(--accent-verify)" }} /></div>
          <div style={{ display: "grid", gap: 12 }}>
            {DIFFICULTIES.map((d) => {
              const tierCards = cardsByDiff.filter((c) => c.difficulty === d.id);
              const tierMastered = tierCards.filter((c) => progress.flashcards?.[c.id]?.mastered).length;
              const tierPct = tierCards.length ? Math.round((tierMastered / tierCards.length) * 100) : 0;
              return (
                <div key={d.id}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 13.5, color: "var(--paper)" }}>{d.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {tierCards.length ? `${tierMastered}/${tierCards.length} mastered` : "No cards yet"}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${tierPct}%`, background: tierPct >= 80 ? "var(--accent-green)" : tierPct >= 50 ? "var(--accent-verify)" : "var(--accent-red)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Practice, by difficulty</span>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {DIFFICULTIES.map((d) => {
              const s = diffStats(progress, d.id);
              return (
                <div key={d.id}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 13.5, color: "var(--paper)" }}>{d.label}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-soft)" }}>
                      {s.attempted ? `${s.accuracy}% · ${s.attempted} attempted` : "Not started"}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${s.attempted ? s.accuracy : 0}%`, background: s.accuracy >= 80 ? "var(--accent-green)" : s.accuracy >= 50 ? "var(--accent-verify)" : "var(--accent-red)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>AI Tutor sessions</span>
          {(() => {
            const t = progress.tutor || { questions: 0, sessions: 0, helpful: 0, notHelpful: 0 };
            const rated = t.helpful + t.notHelpful;
            const helpfulPct = rated ? Math.round((t.helpful / rated) * 100) : null;
            if (!t.questions) {
              return <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 8 }}>No tutoring sessions yet — ask the AI Tutor a question to start tracking this.</p>;
            }
            return (
              <>
                <div className="flex items-center" style={{ gap: 18, marginTop: 10, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--paper)" }}>{t.sessions}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Session{t.sessions === 1 ? "" : "s"}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--paper)" }}>{t.questions}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>Question{t.questions === 1 ? "" : "s"} asked</div>
                  </div>
                </div>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, color: "var(--paper)" }}>Found helpful</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-soft)" }}>
                    {helpfulPct === null ? "Not rated yet" : `${helpfulPct}% · ${rated} rated`}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${helpfulPct || 0}%`, background: helpfulPct >= 80 ? "var(--accent-green)" : helpfulPct >= 50 ? "var(--accent-verify)" : "var(--accent-red)" }} />
                </div>
              </>
            );
          })()}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <span style={{ color: "var(--paper)", fontSize: 15, fontWeight: 600 }}>Study history</span>
          {history.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 13, marginTop: 10 }}>Nothing logged yet — review a summary, flip a flashcard, or answer a practice question to start your timeline.</p>
          ) : (
            <>
              <div className="timeline">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="timeline-date">{g.label}</div>
                    {g.items.map((ev) => <TimelineItem key={ev.id} ev={ev} />)}
                  </div>
                ))}
              </div>
              {visible < history.length && (
                <button className="btn-ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => setVisible((v) => v + 15)}>
                  Show more
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function groupHistoryByDate(history) {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const buckets = {};
  const order = [];
  for (const ev of history) {
    const d = new Date(ev.ts).toISOString().slice(0, 10);
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(ev.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (!buckets[label]) { buckets[label] = []; order.push(label); }
    buckets[label].push(ev);
  }
  return order.map((label) => ({ label, items: buckets[label] }));
}

const TIMELINE_ICONS = { reviewed: BookOpen, flashcard: Layers, practice: GraduationCap, tutor: MessageCircle, test: ClipboardCheck };

function TimelineItem({ ev }) {
  const Icon = TIMELINE_ICONS[ev.type] || TrendingUp;
  const time = new Date(ev.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <div className="timeline-item">
      <div className={"timeline-icon" + (ev.correct === true ? " good" : ev.correct === false ? " bad" : "")}>
        <Icon size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.label}</div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
          {time}{ev.badge ? ` · ${ev.badge}` : ""}{ev.correct === true ? " · Correct" : ev.correct === false ? " · Missed" : ""}
        </div>
      </div>
    </div>
  );
}

function TopicRow({ t }) {
  const label = !t.started ? "Not started" : t.score >= 80 ? "Strong" : t.score >= 50 ? "Getting there" : "Focus here";
  const color = !t.started ? "var(--ink-soft)" : t.score >= 80 ? "var(--accent-green)" : t.score >= 50 ? "var(--accent-verify)" : "var(--accent-red)";
  const pct = t.started ? t.score : 0;
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
        <span style={{ fontSize: 14, color: "var(--paper)", fontWeight: 500 }}>{t.topic}</span>
        <span className="topic-status" style={{ color, borderColor: color }}>{label}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
        {t.flashTotal > 0 && `${t.flashMastered}/${t.flashTotal} flashcards mastered`}
        {t.flashTotal > 0 && t.practiceTotal > 0 && " · "}
        {t.practiceTotal > 0 && `${t.practiceAttempted}/${t.practiceTotal} practice questions attempted`}
      </div>
    </div>
  );
}

function ReviewPip({ label, done }) {
  return (
    <div className="flex items-center" style={{ gap: 6 }}>
      <span className={"pip" + (done ? " done" : "")}>{done && <Check size={11} />}</span>
      <span style={{ fontSize: 13, color: done ? "var(--paper)" : "var(--ink-soft)" }}>{label}</span>
    </div>
  );
}

/* ---------------- global style ---------------- */
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
      :root {
        --ink: #14171F;
        --ink-2: #1B1F2A;
        --paper: #F6F1E7;
        --ink-soft: #8A8F9E;
        --line: #2A2E3A;
        --accent-verify: #E8B23D;
        --accent-teal: #4FBDBA;
        --accent-red: #C97064;
        --accent-green: #6FA97B;
        --font-display: 'Fraunces', Georgia, serif;
        --font-body: 'Inter', system-ui, sans-serif;
        --font-mono: 'JetBrains Mono', monospace;
      }
      * { box-sizing: border-box; }
      .flex { display: flex; }
      .flex-col { flex-direction: column; }
      .items-center { align-items: center; }
      .justify-center { justify-content: center; }
      .justify-between { justify-content: space-between; }
      .spin { animation: spin 0.9s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .brandmark { width: 56px; height: 56px; border-radius: 14px; background: var(--accent-verify); color: var(--ink); font-family: var(--font-display); font-size: 28px; display: flex; align-items: center; justify-content: center; font-weight: 600; }
      .brandmark.small { width: 34px; height: 34px; font-size: 17px; border-radius: 9px; }

      .card { background: var(--ink-2); border: 1px solid var(--line); border-radius: 14px; }
      .card.dashed { border-style: dashed; }

      .input { width: 100%; background: var(--ink); border: 1px solid var(--line); color: var(--paper); border-radius: 10px; padding: 11px 13px; font-size: 14px; font-family: var(--font-body); outline: none; margin-top: 2px; }
      .input:focus { border-color: var(--accent-teal); }
      textarea.input { resize: vertical; }

      .field-label { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: 1px; color: var(--ink-soft); text-transform: uppercase; margin-bottom: 4px; }

      .btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent-verify); color: var(--ink); border: none; border-radius: 10px; padding: 11px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
      .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn-secondary { display: inline-flex; align-items: center; gap: 7px; background: transparent; color: var(--accent-teal); border: 1px solid var(--accent-teal); border-radius: 9px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
      .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: transparent; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 9px; padding: 8px 12px; font-size: 13px; cursor: pointer; }

      .icon-btn { background: transparent; border: none; color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 8px; }
      .icon-btn:hover { background: var(--line); color: var(--paper); }
      .icon-btn.tiny { padding: 4px; }
      .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

      .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }

      .sidebar { width: 250px; background: var(--ink); border-right: 1px solid var(--line); display: flex; flex-direction: column; flex-shrink: 0; }
      .shelf-item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 9px; color: var(--ink-soft); font-size: 14px; cursor: pointer; margin-bottom: 2px; }
      .shelf-item:hover { background: var(--ink-2); }
      .shelf-item.active { background: var(--ink-2); color: var(--paper); }
      .role-badge { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

      .topbar { display: flex; align-items: center; gap: 12px; padding: 16px 24px; border-bottom: 1px solid var(--line); }
      .tabbar { display: flex; gap: 8px; padding: 0 24px; overflow-x: auto; border-bottom: 1px solid var(--line); }
      .tab-pill { display: flex; align-items: center; gap: 6px; white-space: nowrap; background: transparent; border: none; color: var(--ink-soft); padding: 12px 10px; font-size: 13.5px; cursor: pointer; border-bottom: 2px solid transparent; }
      .tab-pill.active { color: var(--accent-verify); border-bottom-color: var(--accent-verify); }

      .stamp-chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--accent-verify); border: 1px solid var(--accent-verify); border-radius: 100px; padding: 5px 10px; }

      .mastery-chip { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.4px; color: var(--ink-soft); border: 1px solid var(--line); border-radius: 100px; padding: 5px 10px; }
      .mastery-chip.done { color: var(--accent-green); border-color: var(--accent-green); }
      .mastery-badge { position: absolute; top: -10px; right: 6px; z-index: 2; display: inline-flex; align-items: center; gap: 4px; background: var(--accent-green); color: var(--ink); font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; border-radius: 100px; padding: 4px 9px; }
      .flash-card { position: relative; }

      .btn-rate { display: inline-flex; align-items: center; gap: 6px; border-radius: 9px; padding: 9px 14px; font-size: 13px; cursor: pointer; border: 1px solid var(--line); background: var(--ink-2); }
      .btn-rate.weak { color: var(--accent-red); border-color: var(--accent-red); }
      .btn-rate.strong { color: var(--accent-green); border-color: var(--accent-green); }
      .btn-rate.small { padding: 5px 10px; font-size: 12px; }

      .diff-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-left: 6px; vertical-align: middle; }

      .streak-card { display: flex; align-items: center; gap: 14px; padding: 18px 20px; }
      .progress-track { width: 100%; height: 7px; border-radius: 100px; background: var(--ink); overflow: hidden; }
      .progress-fill { height: 100%; border-radius: 100px; transition: width 0.4s; }
      .pip { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--ink); flex-shrink: 0; }
      .pip.done { background: var(--accent-green); border-color: var(--accent-green); }

      .timeline { margin-top: 12px; display: flex; flex-direction: column; gap: 2px; }
      .timeline-date { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink-soft); margin: 14px 0 8px; }
      .timeline-date:first-child { margin-top: 0; }
      .timeline-item { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-left: 2px solid var(--line); padding-left: 14px; margin-left: 6px; }
      .timeline-icon { width: 24px; height: 24px; border-radius: 50%; background: var(--ink); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--ink-soft); flex-shrink: 0; margin-left: -19px; }
      .timeline-icon.good { color: var(--accent-green); border-color: var(--accent-green); }
      .timeline-icon.bad { color: var(--accent-red); border-color: var(--accent-red); }

      .error-line { display: flex; align-items: center; gap: 6px; color: var(--accent-red); font-size: 13px; margin-bottom: 10px; }

      .segmented { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
      .segmented button { flex: 1; padding: 9px; background: var(--ink); color: var(--ink-soft); border: none; font-size: 13px; cursor: pointer; }
      .segmented button.active { background: var(--accent-verify); color: var(--ink); font-weight: 600; }

      .drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40; display: none; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .modal { background: var(--ink-2); border: 1px solid var(--line); border-radius: 16px; padding: 22px; width: 92%; max-height: 88vh; overflow-y: auto; }

      .flash-card { width: 100%; max-width: 420px; height: 240px; perspective: 1200px; cursor: pointer; }
      .flash-inner { position: relative; width: 100%; height: 100%; transition: transform 0.5s; transform-style: preserve-3d; }
      .flash-inner.flipped { transform: rotateY(180deg); }
      .flash-face { position: absolute; inset: 0; backface-visibility: hidden; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
      .flash-face.front { background: var(--ink-2); border: 1px solid var(--line); }
      .flash-face.back { background: var(--accent-verify); color: var(--ink); transform: rotateY(180deg); }
      .flash-face p { font-size: 17px; color: var(--paper); line-height: 1.5; margin-top: 10px; }
      .flash-face.back p { color: var(--ink); font-weight: 500; }
      .flash-label { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink-soft); }
      .flash-face.back .flash-label { color: rgba(20,23,31,0.6); }

      .diff-row { display: flex; gap: 8px; overflow-x: auto; }
      .diff-pill { white-space: nowrap; background: var(--ink-2); border: 1px solid var(--line); color: var(--ink-soft); padding: 8px 14px; border-radius: 100px; font-size: 13px; cursor: pointer; }
      .diff-pill.active { background: var(--accent-verify); color: var(--ink); border-color: var(--accent-verify); font-weight: 600; }

      .mcq-option { text-align: left; background: var(--ink); border: 1px solid var(--line); color: var(--paper); border-radius: 9px; padding: 10px 12px; font-size: 14px; cursor: pointer; }
      .mcq-option:disabled { cursor: default; }
      .mcq-option.correct { border-color: var(--accent-green); background: rgba(111,169,123,0.12); color: var(--accent-green); }
      .mcq-option.incorrect { border-color: var(--accent-red); background: rgba(201,112,100,0.12); color: var(--accent-red); }
      .mcq-option.correct-dim { border-color: var(--accent-green); color: var(--accent-green); }
      .mcq-option.selected { border-color: var(--accent-verify); background: rgba(232,178,61,0.12); color: var(--accent-verify); }
      .explain-box { background: var(--ink); border-left: 2px solid var(--accent-teal); padding: 10px 12px; border-radius: 6px; font-size: 13.5px; color: var(--ink-soft); margin-top: 6px; line-height: 1.5; }

      .chat-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 12px; }
      .bubble-row { display: flex; }
      .bubble-row.user { justify-content: flex-end; }
      .bubble { max-width: 78%; background: var(--ink-2); border: 1px solid var(--line); color: var(--paper); padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
      .bubble.user { background: var(--accent-verify); color: var(--ink); border: none; }
      .chat-input-row { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line); }
      .rated-note { font-size: 11px; color: var(--ink-soft); margin-top: 5px; }
      .topic-status { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; border: 1px solid; border-radius: 100px; padding: 3px 9px; }

      .mobile-only { display: none; }
      @media (max-width: 860px) {
        .desktop-only { display: none; }
        .mobile-only { display: flex; }
        .sidebar { position: fixed; left: -270px; top: 0; bottom: 0; z-index: 50; transition: left 0.25s; width: 260px; }
        .sidebar.open { left: 0; }
        .drawer-overlay { display: block; }
        .topbar { padding: 14px 16px; }
        .tabbar { padding: 0 12px; }
        div[style*="padding: 20px 24px 60px"] { padding: 16px 16px 60px !important; }
      }
    `}</style>
  );
}
