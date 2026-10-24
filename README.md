# Maxlopp

Maxlopp is a Python project managed with [uv](https://docs.astral.sh/uv/), with a Next.js frontend.

`packages/esma-common` holds shared settings and the health response.

```
frontend/
packages/esma-common
app/
code/
api/
data/
```

## Run

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12 (uv can install it).

```bash
uv sync
uv run python app/main.py "What is RAG?"
```

On the site, type a question in **Ask a term** and press Ask. That runs the same local tutor. Ollama must be running.


The Next.js frontend is in `frontend`. Requires Node.js 20.

```bash
cd frontend
npm run dev
```

Open http://localhost:3000.
