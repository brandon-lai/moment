// Reads a model's streamed section and separates what may render now (the
// <section> markup) from what must wait (scripts). Treats the output as
// untrusted: drops anything before <section, moves inline <script> blocks to
// the end of the document, and defangs elements that could navigate the
// frame or load from elsewhere.

const DANGEROUS = /<(\/?)(meta|base|iframe|frame|frameset|object|embed|form|link|portal|applet)\b/gi;

export function defang(html: string): string {
  return html.replace(DANGEROUS, "&lt;$1$2").replace(/\s(href|src|action|formaction)\s*=\s*(["'])\s*javascript:/gi, " data-blocked=$2");
}

export class SectionSplitter {
  private buf = "";
  private state: "before" | "markup" | "inscript" | "innerscript" | "after" | "tailscript" = "before";
  private scriptBuf = "";
  readonly scripts: string[] = [];
  markupChars = 0;

  // Feed model text; returns markup that is safe to emit now.
  push(text: string): string {
    this.buf += text;
    let out = "";
    for (;;) {
      if (this.state === "before") {
        const i = this.buf.search(/<section\b/i);
        if (i < 0) { this.buf = this.buf.slice(-12); return out; }
        this.buf = this.buf.slice(i);
        this.state = "markup";
      }
      if (this.state === "markup") {
        const scr = this.buf.search(/<script\b/i);
        const end = this.buf.search(/<\/section>/i);
        // Models sometimes put the script marker inside the section.
        const mark = this.buf.indexOf("<!--script-->");
        if (mark >= 0 && (end < 0 || mark < end) && (scr < 0 || mark < scr)) {
          out += this.buf.slice(0, mark);
          this.buf = this.buf.slice(mark + "<!--script-->".length);
          this.state = "innerscript";
          continue;
        }
        if (scr >= 0 && (end < 0 || scr < end)) {
          out += this.buf.slice(0, scr);
          const close = this.buf.indexOf(">", scr);
          if (close < 0) { this.buf = this.buf.slice(scr); break; }
          this.buf = this.buf.slice(close + 1);
          this.state = "inscript";
          continue;
        }
        if (end >= 0) {
          out += this.buf.slice(0, end + "</section>".length);
          this.buf = this.buf.slice(end + "</section>".length);
          this.state = "after";
          continue;
        }
        // Hold back a possibly partial tag at the end.
        const lt = this.buf.lastIndexOf("<");
        const safe = lt >= 0 && this.buf.indexOf(">", lt) < 0 ? lt : this.buf.length;
        out += this.buf.slice(0, safe);
        this.buf = this.buf.slice(safe);
        break;
      }
      if (this.state === "inscript") {
        const end = this.buf.search(/<\/script>/i);
        if (end < 0) { this.scriptBuf += this.buf.slice(0, Math.max(0, this.buf.length - 9)); this.buf = this.buf.slice(Math.max(0, this.buf.length - 9)); break; }
        this.scriptBuf += this.buf.slice(0, end);
        this.scripts.push(this.scriptBuf);
        this.scriptBuf = "";
        this.buf = this.buf.slice(end + "</script>".length);
        this.state = "markup";
        continue;
      }
      if (this.state === "innerscript") {
        const end = this.buf.search(/<\/section>/i);
        if (end < 0) { this.scriptBuf += this.buf.slice(0, Math.max(0, this.buf.length - 10)); this.buf = this.buf.slice(Math.max(0, this.buf.length - 10)); break; }
        this.scriptBuf += this.buf.slice(0, end);
        this.scripts.push(this.scriptBuf.trim());
        this.scriptBuf = "";
        out += "</section>";
        this.buf = this.buf.slice(end + "</section>".length);
        this.state = "after";
        continue;
      }
      if (this.state === "after") {
        const m = this.buf.indexOf("<!--script-->");
        if (m >= 0) { this.buf = this.buf.slice(m + "<!--script-->".length); this.state = "tailscript"; continue; }
        this.buf = this.buf.slice(-14);
        break;
      }
      if (this.state === "tailscript") {
        this.scriptBuf += this.buf;
        this.buf = "";
        break;
      }
    }
    const safe = defang(out);
    this.markupChars += safe.length;
    return safe;
  }

  // End of stream: returns any markup left (closing an unterminated section).
  finish(): string {
    let out = "";
    if (this.state === "markup") {
      out = defang(this.buf) + "</section>";
      this.markupChars += out.length;
    }
    if (this.state === "innerscript") out += "</section>";
    if (this.state === "tailscript" || this.state === "inscript" || this.state === "innerscript") {
      const js = this.scriptBuf.replace(/^\s*```(?:js|javascript)?\s*/i, "").replace(/```\s*$/, "").trim();
      if (js) this.scripts.push(js);
    }
    this.buf = "";
    this.scriptBuf = "";
    return out;
  }
}

export function libsUsed(scripts: string[]): string[] {
  const all = scripts.join("\n");
  const out: string[] = [];
  if (/\bd3\./.test(all)) out.push("d3");
  if (/\banime\s*\(|\banime\./.test(all)) out.push("anime");
  if (/\bTHREE\./.test(all)) out.push("three");
  return out;
}

// Visible text of a page, for moderation and for the next section's context.
export function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
