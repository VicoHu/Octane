import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** 配置 marked：安全默认值 */
marked.setOptions({
  breaks: true,
  gfm: true,
});

/** 将 Markdown 文本渲染为净化后的 HTML */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'strong', 'em', 'del', 'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'alt', 'src', 'class'],
  });
}
