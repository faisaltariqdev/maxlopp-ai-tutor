import { spawn } from "node:child_process";
import path from "node:path";

export const maxDuration = 120;

type Source = "glossary" | "web" | "model";
type Result = { found: boolean; text: string };

const sources: Source[] = ["glossary", "web", "model"];
const MISSING = 3;
const cache = new Map<string, Result>();
const cacheLimit = 200;

export async function POST(request: Request) {
  const body = (await request.json()) as { question?: unknown; source?: unknown };
  const question = String(body.question ?? "").trim();
  const source = (body.source ?? "glossary") as Source;
  if (!question) {
    return Response.json({ error: "Type a question." }, { status: 400 });
  }
  if (question.length > 300) {
    return Response.json({ error: "Keep the question under 300 characters." }, { status: 400 });
  }
  if (!sources.includes(source)) {
    return Response.json({ error: "Unknown answer source." }, { status: 400 });
  }

  const key = `${source}:${question.toLowerCase().replace(/\s+/g, " ")}`;
  const cached = cache.get(key);
  if (cached) return Response.json({ ...cached, source });

  try {
    const result = await askAgent(question, source);
    if (result.found) {
      if (cache.size >= cacheLimit) cache.clear();
      cache.set(key, result);
    }
    return Response.json({ ...result, source });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The tutor could not answer.";
    return Response.json({ error: message }, { status: 500 });
  }
}

function askAgent(question: string, source: Source) {
  const root = path.resolve(process.cwd(), "..");
  const pathEnv = `${process.env.HOME}/.local/bin:${process.env.PATH ?? ""}`;

  return new Promise<Result>((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "app/main.py", `--${source}`, question], {
      cwd: root,
      env: { ...process.env, PATH: pathEnv },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The tutor took too long. Check that Ollama is running."));
    }, 110_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (code === 0 && text) {
        resolve({ found: true, text });
        return;
      }
      if (code === MISSING) {
        resolve({ found: false, text });
        return;
      }
      reject(new Error(stderr.trim() || "The tutor could not answer."));
    });
  });
}
