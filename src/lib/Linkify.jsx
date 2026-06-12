/**
 * src/lib/Linkify.jsx
 *
 * Renders text with any URLs converted to clickable links that open in a
 * new tab. Drop-in: replace `{item.content}` with `<Linkify text={item.content} />`
 * anywhere knowledge content, sources, or notes are displayed.
 */

const URL_SPLIT_RE = /(https?:\/\/[^\s<>"')\]]+)/g
const IS_URL_RE = /^https?:\/\//

export default function Linkify({ text, linkColor = '#3b82f6' }) {
    if (!text) return null
    const parts = String(text).split(URL_SPLIT_RE)
    return (
        <>
            {parts.map((part, i) =>
                IS_URL_RE.test(part) ? (
                    <a
                        key={i}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            color: linkColor,
                            textDecoration: 'underline',
                            textUnderlineOffset: '2px',
                            wordBreak: 'break-all',
                        }}
                    >
                        {part}
                    </a>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    )
}
