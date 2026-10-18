// Markdown rendering (GitHub-flavoured via marked) with DOMPurify sanitising.
// Both libraries are loaded as globals from /vendor.
//
// Single newlines become line breaks (as in a notes app such as Standard
// Notes), so a description written line by line stays dense; a blank line
// still starts a new paragraph. The dense styling itself is in app.css (.md).

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(src) {
  if (!src) return '';
  const html = marked.parse(src);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
