"use client";

import { useEffect, useRef, useState } from "react";

type View = "lesson" | "progress";
type Phase = "streaming" | "simpler-streaming" | "review" | "approved";
type Choice = "a" | "b" | "c";
type Source = "glossary" | "web" | "model";
type Ask =
  | { status: "idle" }
  | { status: "loading"; source: Source }
  | { status: "choose"; question: string; webTried: boolean }
  | { status: "answer"; body: string; source: Source; ref: string }
  | { status: "error"; message: string };

const explanations = {
  standard:
    "RAG lets a language model look up information before it writes an answer. It uses that source instead of relying only on what it memorized during training.",
  simple: "The model looks something up first. Then it answers using what it found.",
};

const sourceQuote =
  "A method that retrieves outside information and gives it to a language model before the model writes an answer.";

const choices: Array<[Choice, string]> = [
  ["a", "It only uses what it memorized in training."],
  ["b", "It looks up outside information first."],
  ["c", "It deletes the question and starts over."],
];

const xpCap = 250;

const loadingText: Record<Source, string> = {
  glossary: "Checking the glossary",
  web: "Searching the web",
  model: "Asking the local model",
};

const sourceLabel: Record<Source, string> = {
  glossary: "Glossary",
  web: "Web",
  model: "Model knowledge",
};

function feedbackText(quiz: Choice) {
  return quiz === "b"
    ? "Yes. RAG retrieves a source, then the model writes from that source."
    : "Not quite. RAG looks up information first, then answers from it.";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function splitAnswer(text: string) {
  const match = text.match(/\nSource \((?:glossary|web|model knowledge)\): (.+)$/);
  if (!match) return { body: text, ref: "" };
  return { body: text.slice(0, match.index).trim(), ref: match[1].trim() };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LessonApp() {
  const [view, setView] = useState<View>("lesson");
  const [phase, setPhase] = useState<Phase>("streaming");
  const [explanation, setExplanation] = useState<keyof typeof explanations>("standard");
  const [revealed, setRevealed] = useState(0);
  const [approved, setApproved] = useState(false);
  const [quiz, setQuiz] = useState<Choice | null>(null);
  const [feedbackRevealed, setFeedbackRevealed] = useState(0);
  const [xp, setXp] = useState(200);
  const [credits, setCredits] = useState(12);
  const [question, setQuestion] = useState("");
  const [ask, setAsk] = useState<Ask>({ status: "idle" });
  const awarded = useRef({ approval: false, quiz: false });
  const streak = 4;

  useEffect(() => {
    if (phase !== "streaming" && phase !== "simpler-streaming") return;
    const full = explanations[explanation];
    const step = prefersReducedMotion() ? full.length : 1;
    const id = window.setInterval(() => {
      setRevealed((current) => {
        const next = Math.min(full.length, current + step);
        if (next >= full.length) {
          window.clearInterval(id);
          setPhase("review");
        }
        return next;
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [phase, explanation]);

  useEffect(() => {
    if (!quiz) return;
    const full = feedbackText(quiz);
    const step = prefersReducedMotion() ? full.length : 1;
    const id = window.setInterval(() => {
      setFeedbackRevealed((current) => {
        const next = Math.min(full.length, current + step);
        if (next >= full.length) window.clearInterval(id);
        return next;
      });
    }, 16);
    return () => window.clearInterval(id);
  }, [quiz]);

  const streaming = phase === "streaming" || phase === "simpler-streaming";
  const shown = explanations[explanation].slice(0, revealed);
  const level = xp >= xpCap ? 3 : 2;
  const loading = ask.status === "loading";
  const badges: Array<[string, boolean]> = [
    ["First term", true],
    ["Source reader", approved],
    ["4-day streak", true],
    ["Quiz clear", quiz === "b"],
  ];

  async function runAsk(text: string, source: Source, webTried = false) {
    setAsk({ status: "loading", source });
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, source }),
      });
      const payload = (await response.json()) as { found?: boolean; text?: string; error?: string };
      if (!response.ok || payload.error) {
        setAsk({ status: "error", message: payload.error ?? "The tutor could not answer." });
        return;
      }
      if (!payload.found || !payload.text) {
        setAsk({ status: "choose", question: text, webTried: webTried || source === "web" });
        return;
      }
      setAsk({ status: "answer", source, ...splitAnswer(payload.text) });
    } catch {
      setAsk({ status: "error", message: "The tutor could not answer. Check that Ollama is running." });
    }
  }

  function onAsk(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading) return;
    void runAsk(text, "glossary");
  }

  function approve() {
    setPhase("approved");
    setApproved(true);
    if (awarded.current.approval) return;
    awarded.current.approval = true;
    setXp((value) => value + 20);
    setCredits((value) => value + 2);
  }

  function simpler() {
    setExplanation("simple");
    setRevealed(0);
    setPhase("simpler-streaming");
    setApproved(false);
  }

  function answer(choice: Choice) {
    if (!approved || quiz) return;
    setFeedbackRevealed(0);
    setQuiz(choice);
    if (choice !== "b" || awarded.current.quiz) return;
    awarded.current.quiz = true;
    setXp((value) => value + 30);
    setCredits((value) => value + 5);
  }

  const askResult = (() => {
    if (ask.status === "loading") {
      return (
        <p className="ask-status" role="status">
          {loadingText[ask.source]}
          <span className="dots" aria-hidden="true"><span /><span /><span /></span>
        </p>
      );
    }
    if (ask.status === "error") {
      return <p className="notice notice-danger" role="alert">{ask.message}</p>;
    }
    if (ask.status === "choose") {
      return (
        <section className="permission" aria-labelledby="permission-title">
          <h3 id="permission-title">
            {ask.webTried ? "No web result found" : `“${ask.question}” is not in the glossary`}
          </h3>
          <p>
            Choose where the answer should come from. Nothing runs until you choose.
          </p>
          <ul className="permission-list">
            {ask.webTried ? null : (
              <li><strong>Web search</strong> sends your question to DuckDuckGo and may read Wikipedia.</li>
            )}
            <li><strong>Model knowledge</strong> stays on this computer, but the model can be wrong.</li>
          </ul>
          <div className="actions">
            {ask.webTried ? null : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void runAsk(ask.question, "web")}
              >
                Search the web
              </button>
            )}
            <button
              className={ask.webTried ? "btn btn-primary" : "btn btn-secondary"}
              type="button"
              onClick={() => void runAsk(ask.question, "model", ask.webTried)}
            >
              Use model knowledge
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => setAsk({ status: "idle" })}>
              Cancel
            </button>
          </div>
        </section>
      );
    }
    if (ask.status === "answer") {
      const link = ask.ref.startsWith("http");
      return (
        <section className="answer" aria-live="polite">
          <p className="answer-body">{ask.body}</p>
          <div className="answer-meta">
            <span className={`chip chip-${ask.source}`}>{sourceLabel[ask.source]}</span>
            {link ? (
              <a href={ask.ref} target="_blank" rel="noopener noreferrer">{hostOf(ask.ref)}</a>
            ) : (
              <span>{ask.ref}</span>
            )}
          </div>
          {ask.source === "model" ? (
            <p className="answer-note">Generated by the local model, not checked against a source.</p>
          ) : null}
        </section>
      );
    }
    return null;
  })();

  const askPanel = (
    <section className="card ask-panel" aria-labelledby="ask-title">
      <div className="card-head">
        <div>
          <p className="kicker">Ask a term</p>
          <h2 id="ask-title">Look up any AI term</h2>
        </div>
        <p className="card-hint">Glossary first. Web or model only with your permission.</p>
      </div>
      <form className="ask-form" onSubmit={onAsk}>
        <label className="sr" htmlFor="question">Question</label>
        <input
          id="question"
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What is a transformer?"
          maxLength={300}
          autoComplete="off"
        />
        <button className="btn btn-primary" type="submit" disabled={loading || question.trim().length === 0}>
          {loading ? "Working" : "Ask"}
        </button>
      </form>
      {askResult}
    </section>
  );

  const lesson = (
    <article className="card lesson" aria-labelledby="lesson-title">
      <div className="card-head">
        <div>
          <p className="kicker">Today&apos;s term</p>
          <h2 id="lesson-title">RAG</h2>
        </div>
        <a
          className="chip chip-glossary"
          href="https://hai.stanford.edu/ai-definitions/what-is-rag"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source · Stanford HAI
        </a>
      </div>
      <p className="stream" aria-live="polite">
        {shown}
        {streaming ? <span className="caret" aria-hidden="true" /> : null}
      </p>
      <blockquote>
        <span>Glossary definition</span>
        {sourceQuote}
      </blockquote>
      <section className="review" aria-labelledby="review-title">
        <div>
          <h3 id="review-title">Review before the quiz</h3>
          <p>A person approves the explanation. The quiz stays locked until then.</p>
        </div>
        {approved ? (
          <p className="notice notice-ok">Approved. The quiz is open.</p>
        ) : (
          <div className="actions">
            <button className="btn btn-primary" type="button" onClick={approve} disabled={streaming}>
              Approve explanation
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={simpler}
              disabled={streaming || explanation === "simple"}
            >
              Simpler version
            </button>
          </div>
        )}
      </section>
    </article>
  );

  const quizCard = (
    <section className="card quiz" aria-labelledby="quiz-title">
      <p className="kicker">Quiz</p>
      <h2 id="quiz-title" className="quiz-title">What does RAG do before answering?</h2>
      {approved ? null : <p className="lock">Approve the explanation to start.</p>}
      <div className="options">
        {choices.map(([id, label]) => (
          <button
            key={id}
            className="option"
            type="button"
            aria-pressed={quiz === id}
            disabled={!approved || quiz !== null}
            onClick={() => answer(id)}
          >
            <span className="option-key" aria-hidden="true">{id.toUpperCase()}</span>
            {label}
          </button>
        ))}
      </div>
      {quiz ? (
        <p className={`notice ${quiz === "b" ? "notice-ok" : "notice-danger"}`} aria-live="polite">
          <strong>{quiz === "b" ? "Correct." : "Not this time."}</strong>{" "}
          {feedbackText(quiz).slice(0, feedbackRevealed)}
        </p>
      ) : null}
    </section>
  );

  const progress = (
    <div className="progress-grid">
      <section className="card" aria-labelledby="level-title">
        <p className="kicker">Level</p>
        <h2 id="level-title" className="metric">Level {level}</h2>
        <div
          className="bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={xpCap}
          aria-valuenow={xp}
          aria-label="Experience points"
        >
          <span style={{ width: `${Math.min(100, Math.round((xp / xpCap) * 100))}%` }} />
        </div>
        <p className="muted">{xp} of {xpCap} XP</p>
      </section>
      <section className="card">
        <p className="kicker">Streak</p>
        <p className="metric">{streak} days</p>
        <p className="muted">Keep one term a day.</p>
      </section>
      <section className="card">
        <p className="kicker">Credits</p>
        <p className="metric">{credits}</p>
        <p className="muted">Earned from approvals and quizzes.</p>
      </section>
      <section className="card span-2" aria-labelledby="badges-title">
        <p className="kicker">Badges</p>
        <h2 id="badges-title" className="sr">Badges</h2>
        <div className="badges">
          {badges.map(([name, on]) => (
            <span className={on ? "badge" : "badge badge-wait"} key={name}>
              {name}{on ? "" : " · not yet"}
            </span>
          ))}
        </div>
      </section>
      <section className="card" aria-labelledby="week-title">
        <p className="kicker">This week</p>
        <h2 id="week-title" className="sr">This week</h2>
        <ul className="week">
          <li><span>Fine-tuning</span><span className="status status-done">Done</span></li>
          <li><span>Hallucination</span><span className="status status-done">Done</span></li>
          <li>
            <span>RAG</span>
            <span className={quiz === "b" ? "status status-done" : "status"}>
              {quiz === "b" ? "Done" : "In progress"}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">M</span>
            <div>
              <h1 className="brand-name">Maxlopp</h1>
              <p className="brand-tag">One AI term at a time</p>
            </div>
          </div>
          <nav className="tabs" aria-label="Sections">
            {(["lesson", "progress"] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="tab"
                aria-current={view === name ? "page" : undefined}
                onClick={() => setView(name)}
              >
                {name === "lesson" ? "Lesson" : "Progress"}
              </button>
            ))}
          </nav>
          <div className="topbar-side" aria-label="Your progress">
            <span className="status-pill"><i aria-hidden="true" />Safe mode</span>
            <span className="stat">{streak}-day streak</span>
            <span className="stat">{xp} XP</span>
            <span className="stat">{credits} credits</span>
          </div>
        </div>
      </header>
      <main className="page">
        {view === "lesson" ? (
          <>
            {askPanel}
            <div className="lesson-grid">
              {lesson}
              {quizCard}
            </div>
          </>
        ) : (
          progress
        )}
      </main>
    </>
  );
}
