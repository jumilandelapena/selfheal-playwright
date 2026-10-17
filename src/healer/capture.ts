import type { Page } from '@playwright/test';

export interface PageCapture {
  url: string;
  title: string;
  /** YAML accessibility tree from `page.locator('body').ariaSnapshot()`. */
  aria: string;
  /** Trimmed HTML of <body>: no scripts, styles, svg; attribute values and text truncated. */
  dom: string;
  screenshotPng: Buffer;
}

export const DEFAULT_MAX_DOM_CHARS = 30_000;

/** Capture what the AI needs to see: accessibility tree, trimmed DOM and a screenshot. */
export async function capturePage(page: Page, maxDomChars = DEFAULT_MAX_DOM_CHARS): Promise<PageCapture> {
  const [aria, dom, screenshotPng, title] = await Promise.all([
    page.locator('body').ariaSnapshot(),
    page.evaluate(trimDom, maxDomChars),
    page.screenshot({ type: 'png', fullPage: false }),
    page.title(),
  ]);
  return { url: page.url(), title, aria, dom, screenshotPng };
}

/* Runs inside the browser. Keep it self-contained: no closures over Node values. */
function trimDom(maxChars: number): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, svg, noscript, template, iframe, link, meta, canvas, video, audio, object')
    .forEach((node) => node.remove());

  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.COMMENT_NODE) {
      comments.push(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      element.removeAttribute('style');
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith('on') || attribute.value.startsWith('data:')) {
          element.removeAttribute(attribute.name);
        } else if (attribute.value.length > 200) {
          element.setAttribute(attribute.name, `${attribute.value.slice(0, 200)}…`);
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.length > 300) {
      node.textContent = `${node.textContent.slice(0, 300)}…`;
    }
    node = walker.nextNode();
  }
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));

  let html = clone.innerHTML.replace(/\s+/g, ' ').trim();
  if (html.length > maxChars) html = `${html.slice(0, maxChars)}\n<!-- truncated to ${maxChars} characters -->`;
  return html;
}
