import json
import os
import re
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

from ddgs import DDGS
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_ollama import ChatOllama
from pydantic import BaseModel, Field

GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "data" / "glossary.json"
MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:0.8b")


class GlossaryTerm(BaseModel):
    term: str
    definition: str
    url: str


class Glossary(BaseModel):
    title: str
    source: str
    terms: list[GlossaryTerm]


class LookupTermInput(BaseModel):
    """Arguments the agent sends when it looks up one glossary term."""

    name: str = Field(
        description="The AI glossary term to look up, for example RAG or Transformer."
    )


class SearchWebInput(BaseModel):
    """Arguments the agent sends when the glossary has no entry."""

    query: str = Field(description="The question to search for on the web.")


def _glossary() -> Glossary:
    return Glossary.model_validate_json(GLOSSARY_PATH.read_text(encoding="utf-8"))


def _normalize(text: str) -> str:
    cleaned = "".join(ch if ch.isalnum() else " " for ch in text.lower())
    return " ".join(cleaned.split())


def _candidates(name: str) -> set[str]:
    text = _normalize(name)
    prefixes = (
        "what is a ",
        "what is an ",
        "what is ",
        "what s ",
        "what are ",
        "what does ",
        "define ",
        "explain ",
        "meaning of ",
        "tell me about ",
    )
    for prefix in prefixes:
        if text.startswith(prefix):
            text = text[len(prefix):]
    for suffix in (" mean", " means", " meaning"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    text = text.strip()
    if not text:
        return set()
    return {text, text.replace(" ", "")}


def _aliases(term: str) -> set[str]:
    short, _, acronym = term.partition("(")
    names = [term, short]
    if acronym.endswith(")"):
        names.append(acronym[:-1])
    aliases: set[str] = set()
    for name in names:
        normal = _normalize(name)
        if normal:
            aliases.add(normal)
            aliases.add(normal.replace(" ", ""))
    return aliases


def _miss(name: str) -> str:
    return f"No glossary entry matched {name!r}."


@tool(args_schema=LookupTermInput)
def lookup_term(name: str) -> str:
    """Look up one AI glossary term by name and return its definition and source URL."""
    wanted = _candidates(name)
    if not wanted:
        return _miss(name)
    for term in _glossary().terms:
        if wanted & _aliases(term.term):
            return f"{term.term}: {term.definition}\nSource (glossary): {term.url}"
    return _miss(name)


def _search_phrase(question: str) -> str:
    raw = " ".join(question.split())
    options = _candidates(question)
    if not options:
        return raw
    if _normalize(raw).startswith(("what ", "define ", "explain ", "meaning ")):
        return raw
    return f"what is {max(options, key=len)}"


def _web_hits(query: str) -> list[dict[str, str]]:
    try:
        rows = DDGS(timeout=12).text(_search_phrase(query), max_results=5)
    except Exception:
        return []
    hits: list[dict[str, str]] = []
    for row in rows or []:
        href = str(row.get("href") or "").strip()
        body = " ".join(str(row.get("body") or "").split())
        title = " ".join(str(row.get("title") or "").split())
        if href.startswith("http") and body:
            hits.append({"title": title, "href": href, "body": body})
    return [hit for hit in hits if _relevant(hit, query)]


def _relevant(hit: dict[str, str], question: str) -> bool:
    haystack = _normalize(f"{hit['title']} {hit['body']}").replace(" ", "")
    for option in _candidates(question):
        token = option.replace(" ", "")
        if len(token) >= 3 and token in haystack:
            return True
    return False


def _pick(hits: list[dict[str, str]]) -> dict[str, str]:
    for hit in hits:
        if "wikipedia.org/wiki/" in hit["href"]:
            return hit
    return hits[0]


def _wiki_extract(url: str) -> str:
    path = unquote(urlparse(url).path)
    if "/wiki/" not in path:
        return ""
    title = path.split("/wiki/", 1)[1]
    namespace = title.split(":", 1)[0]
    if namespace in {"File", "Category", "Help", "Wikipedia", "Template", "Special"}:
        return ""
    api = "https://en.wikipedia.org/api/rest_v1/page/summary/" + quote(title, safe="()")
    request = Request(api, headers={"User-Agent": "MaxloppGlossaryTutor/0.1"})
    try:
        with urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except (OSError, URLError, json.JSONDecodeError, TimeoutError):
        return ""
    extract = payload.get("extract") if isinstance(payload, dict) else ""
    return extract.strip() if isinstance(extract, str) else ""


def _short(text: str) -> str:
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    short = " ".join(sentences[:2]).strip()
    if len(short) > 500:
        return short[:497].rstrip() + "..."
    return short


def _from_web(question: str) -> str:
    hits = _web_hits(question)
    if not hits:
        return ""
    hit = _pick(hits)
    text = _wiki_extract(hit["href"]) if "wikipedia.org/wiki/" in hit["href"] else ""
    text = _short(text or hit["body"])
    if not text:
        return ""
    return f"{text}\nSource (web): {hit['href']}"


@tool(args_schema=SearchWebInput)
def search_web(query: str) -> str:
    """Search the web and return a short explanation plus the page URL."""
    found = _from_web(query)
    return found or "No web result found."


def build_agent():
    model = ChatOllama(model=MODEL, temperature=0)
    return create_agent(
        model=model,
        tools=[lookup_term, search_web],
        system_prompt=(
            "You are Maxlopp, a beginner tutor. "
            "Call lookup_term first. If it returns a definition, reply with only that text. "
            "If the glossary misses, call search_web and reply with only that text. "
            "If search_web finds nothing, answer from your own knowledge in one or two simple sentences. "
            "Do not invent a URL."
        ),
    )


def _message_text(message: object) -> str:
    content = getattr(message, "content", "")
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text") or ""))
        text = "\n".join(parts)
    else:
        text = str(content or "")
    if text.strip():
        return text
    return str(getattr(message, "content_blocks", "") or "")


def _clean_answer(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"https?://\S+", "", text)
    kept = [
        line
        for line in text.splitlines()
        if not line.strip().lower().startswith("source")
    ]
    return " ".join(" ".join(kept).split())


def _web_from_agent(result: dict) -> str:
    for message in result["messages"]:
        if getattr(message, "type", None) != "tool":
            continue
        content = getattr(message, "content", "")
        if isinstance(content, str) and "\nSource (web):" in content:
            return content.strip()
    return ""


def _from_model(question: str) -> str:
    result = build_agent().invoke(
        {"messages": [{"role": "user", "content": question}]}
    )
    web = _web_from_agent(result)
    if web:
        return web
    text = _clean_answer(_message_text(result["messages"][-1]))
    if not text or text.startswith("No glossary entry matched"):
        text = "I do not know this."
    return f"{text}\nSource (model knowledge): {MODEL}"


def answer(question: str) -> str:
    direct = lookup_term.invoke({"name": question})
    if not direct.startswith("No glossary entry matched"):
        return direct
    web = _from_web(question)
    if web:
        return web
    return _from_model(question)


def main() -> None:
    question = " ".join(sys.argv[1:]).strip() or "What is RAG?"
    print(answer(question))


if __name__ == "__main__":
    main()
