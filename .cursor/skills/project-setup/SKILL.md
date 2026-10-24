---
name: project-setup
description: >-
  Set up and configure the Maxlopp tutor: uv, Python 3.12, the Ollama model,
  environment variables, and the Next.js site. Use when the user asks to set
  up, install, configure, run, change the model, fix Ollama, or fix uv.
---

# Maxlopp setup and configuration

Work from the repository root. Do not commit `.env` or `.env.local`.

## What actually runs

The tutor is `app/main.py`. The site does not call an HTTP API. `frontend/app/api/ask/route.ts` runs:

```bash
uv run python app/main.py "<question>"
```

with the repository root as the working directory. `HOST`, `PORT`, and `SERVICE_NAME` in `.env.example` are unused by this tutor. `packages/esma-common` reads a root `.env` for its own settings; the tutor does not import it.

## Install

1. Require [uv](https://docs.astral.sh/uv/). Python is 3.12 (`.python-version`). `uv sync` installs it.
2. From the repository root, run `uv sync`.
3. Require [Ollama](https://ollama.com). Pull the configured model and leave Ollama running:

```bash
ollama pull qwen3.5:0.8b
```

4. For the site, require Node.js 20. From `frontend`, run `npm install`.

## Configuration

The tutor reads one setting, and only from the process environment:

| Variable | Default | Read by |
|---|---|---|
| `OLLAMA_MODEL` | `qwen3.5:0.8b` | `app/main.py` |

`app/main.py` does not load a `.env` file. Next.js loads env files from `frontend/`, then passes `process.env` into the `uv` child. A root `.env` does not reach the tutor or the site.

- CLI: export `OLLAMA_MODEL` in the shell that runs `uv`, or prefix the command.
- Site: put `OLLAMA_MODEL` in `frontend/.env.local`, then restart `npm run dev`.

```bash
OLLAMA_MODEL=qwen3.5:0.8b uv run python app/main.py "What is RAG?"
```

Change the model by setting `OLLAMA_MODEL` and running `ollama pull` for that name. Do not hard-code a new default in `app/main.py` unless the user asks to change the default.

The ask route prepends `$HOME/.local/bin` to `PATH`. If `uv` is installed somewhere else, the shell that starts Next.js must already have `uv` on `PATH`.

## Run

CLI, from the repository root:

```bash
uv run python app/main.py "What is RAG?"
```

The default source is the glossary. On a miss it exits with code 3 and does not search. Web search and model knowledge run only when asked for:

```bash
uv run python app/main.py --web "What is blockchain?"
uv run python app/main.py --model "What is blockchain?"
```

The site asks the user to choose web or model before it sends either flag.

Site:

```bash
cd frontend
npm run dev
```

Open http://localhost:3000. Ask a term from **Ask a term**. The first answer can take a while because it starts Ollama.

## Check

- `uv run python app/main.py "What is RAG?"` prints a definition and a `Source (glossary):` line.
- If the CLI says the model is missing, run `ollama pull` for `OLLAMA_MODEL`.
- If the site says the tutor took too long, Ollama is not running.
- If the site says `uv` cannot be found, install uv or start Next.js from a shell where `uv` is on `PATH`.
