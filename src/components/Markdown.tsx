/** Renders message content: markdown subset, mentions, emoji, links, code. */
import { Fragment } from 'react';
import { tokenizeMarkdown, type Token } from '../lib/format';
import type { PublicUser, Role } from '../lib/types';

interface MarkdownProps {
  content: string;
  users?: Record<string, PublicUser>;
  roles?: Role[];
  channels?: Record<string, { name: string }>;
}

function renderToken(token: Token, index: number, props: MarkdownProps) {
  switch (token.type) {
    case 'bold':
      return <strong key={index}>{token.value}</strong>;
    case 'italic':
      return <em key={index}>{token.value}</em>;
    case 'underline':
      return <u key={index}>{token.value}</u>;
    case 'strike':
      return <s key={index}>{token.value}</s>;
    case 'code':
      return (
        <code className="inline-code" key={index}>
          {token.value}
        </code>
      );
    case 'codeblock':
      return (
        <pre className="code-block" key={index}>
          <code>{token.value}</code>
        </pre>
      );
    case 'link':
      return (
        <a key={index} href={token.value} target="_blank" rel="noreferrer noopener" onClick={(event) => {
          if (window.neurio?.openExternal) {
            event.preventDefault();
            window.neurio.openExternal(token.value);
          }
        }}>
          {token.value}
        </a>
      );
    case 'user': {
      const user = props.users?.[token.value];
      return (
        <span className="mention" key={index}>
          @{user?.display_name ?? 'unknown'}
        </span>
      );
    }
    case 'role': {
      const role = props.roles?.find((candidate) => candidate.id === token.value);
      return (
        <span className="mention" key={index} style={role && role.color ? { color: `#${role.color.toString(16).padStart(6, '0')}` } : undefined}>
          @{role?.name ?? 'role'}
        </span>
      );
    }
    case 'channel': {
      const channel = props.channels?.[token.value];
      return (
        <span className="mention" key={index}>
          #{channel?.name ?? 'channel'}
        </span>
      );
    }
    case 'everyone':
      return (
        <span className="mention mention-everyone" key={index}>
          {token.value}
        </span>
      );
    default:
      return <Fragment key={index}>{token.value}</Fragment>;
  }
}

export function Markdown({ content, users, roles, channels }: MarkdownProps) {
  const tokens = tokenizeMarkdown(content);
  return (
    <span className="markdown">
      {tokens.map((token, index) => renderToken(token, index, { content, users, roles, channels }))}
    </span>
  );
}
