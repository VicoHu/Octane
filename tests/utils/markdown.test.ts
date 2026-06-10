import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '@/shared/utils/markdown';

describe('Markdown 渲染', () => {
  it('渲染基础段落', () => {
    const result = renderMarkdown('Hello World');
    expect(result).toContain('<p>');
    expect(result).toContain('Hello World');
  });

  it('渲染加粗和斜体', () => {
    const result = renderMarkdown('**bold** and *italic*');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('渲染代码块', () => {
    const result = renderMarkdown('```\nconst x = 1;\n```');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code>');
    expect(result).toContain('const x = 1;');
  });

  it('渲染列表', () => {
    const result = renderMarkdown('- item1\n- item2\n- item3');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
    expect(result).toContain('item1');
  });

  it('渲染链接', () => {
    const result = renderMarkdown('[GitHub](https://github.com)');
    expect(result).toContain('<a');
    expect(result).toContain('href="https://github.com"');
    expect(result).toContain('GitHub');
  });

  it('空字符串返回空', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('GFM 换行（breaks: true）', () => {
    const result = renderMarkdown('第一行\n第二行');
    // breaks: true 时单个换行变为 <br>
    expect(result).toContain('<br>');
  });
});

describe('Markdown XSS 防护', () => {
  it('过滤 script 标签', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert');
  });

  it('过滤 event handler 属性', () => {
    const result = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('过滤 iframe 标签', () => {
    const result = renderMarkdown('<iframe src="https://evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('保留合法标签', () => {
    const result = renderMarkdown('**bold** *italic* `code`');
    expect(result).toContain('<strong>');
    expect(result).toContain('<em>');
    expect(result).toContain('<code>');
  });

  it('过滤 style 标签', () => {
    const result = renderMarkdown('<style>body{display:none}</style>');
    expect(result).not.toContain('<style>');
  });
});
