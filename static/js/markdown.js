// Markdown rendering (GitHub-flavoured via marked) with DOMPurify sanitising.
// Both libraries are loaded as globals from /vendor.

marked.use({ gfm: true, breaks: false });

export function renderMarkdown(src) {
  if (!src) return '';
  const html = marked.parse(src);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
