"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders note / message markdown. Links to sibling .md notes and [[note-name]] wiki links
 * open inside the app instead of navigating away.
 */
export function Markdown({
  children,
  onNoteLink,
  resolveWiki,
}: {
  children: string;
  onNoteLink?: (file: string) => void;
  resolveWiki?: (name: string) => string | null;
}) {
  const text = resolveWiki
    ? children.replace(/\[\[([^\]]+)\]\]/g, (_m, name: string) => {
        const file = resolveWiki(name.trim());
        return file ? `[${name}](${file})` : `\`[[${name}]]\` *(no note with this name)*`;
      })
    : children;

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children: c }) {
            const local = href && !/^[a-z]+:/i.test(href) && href.endsWith(".md");
            if (local && onNoteLink) {
              const file = href.split("/").pop()!;
              return (
                <button type="button" className="md-link" onClick={() => onNoteLink(file)}>
                  {c}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {c}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
