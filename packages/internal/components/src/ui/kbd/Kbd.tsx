import { cn, getOS } from "@follow/utils/utils"
import type { ComponentProps, FC, SVGProps } from "react"
import { Fragment, memo } from "react"

const os = getOS()

const SharedKeys = {
  backspace: "⌫",
  space: "␣",
  pageup: "PageUp",
  pagedown: "PageDown",
  tab: "Tab",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",

  $mod: os === "macOS" ? "⌘" : "Ctrl",
}
const SpecialKeys = {
  Windows: {
    meta: "⊞",
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    escape: "Esc",
  },
  macOS: {
    meta: "⌘",
    ctrl: "⌃",
    control: "⌃",
    alt: "⌥",
    shift: "⇧",
    escape: "⎋",
  },
  Linux: {
    meta: "Super",
    ctrl: "Ctrl",
    control: "Ctrl",
    alt: "Alt",
    shift: "Shift",
    escape: "Escape",
  },
}
// @ts-ignore
SpecialKeys.iOS = SpecialKeys.macOS
// @ts-ignore
SpecialKeys.Android = SpecialKeys.Linux

export const KbdCombined: FC<{
  children: string
  className?: string
  joint?: boolean
  kbdProps?: Partial<ComponentProps<typeof Kbd>>
  abbr?: string
}> = ({ children, joint, className, kbdProps, abbr }) => {
  // A trailing "," is the comma key itself (e.g. "$mod+,"), not a separator
  const keys = children.split(/,(?!,|$)/)
  return (
    <div className="flex items-center gap-1">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {joint ? (
            <Kbd className={className} {...kbdProps} abbr={abbr}>
              {k}
            </Kbd>
          ) : (
            <div className="flex items-center gap-1">
              {k.split("+").map((key) => (
                <Kbd key={key} className={className} {...kbdProps} abbr={abbr}>
                  {key}
                </Kbd>
              ))}
            </div>
          )}
          {i !== keys.length - 1 && (
            <span>
              <i className="i-mgc-line-cute-re size-[0.75em] shrink-0 origin-center translate-y-[0.15em] rotate-[-25deg] text-text-secondary" />
            </span>
          )}
        </Fragment>
      ))}
    </div>
  )
}

export const Kbd: FC<{
  children: string
  className?: string
  abbr?: string
}> = memo(({ children, className, abbr }) => {
  let specialKeys = (SpecialKeys as any)[os] as Record<string, string>
  specialKeys = { ...SharedKeys, ...specialKeys }

  return (
    <kbd
      className={cn(
        "kbd box-border h-5 space-x-1 font-sans text-[0.7rem] tabular-nums text-text transition-all duration-200",
        className,
      )}
      {...(abbr && { title: abbr })}
    >
      {children.split("+").map((key_) => {
        let key: string = key_.toLowerCase()
        for (const [k, v] of Object.entries(specialKeys)) {
          key = key.replace(k, v)
        }

        switch (key) {
          case SharedKeys.space: {
            return <MaterialSymbolsSpaceBarRounded key={key} />
          }

          case SharedKeys.backspace: {
            return <IcOutlineBackspace key={key} />
          }
          case SpecialKeys.macOS.meta: {
            return <MaterialSymbolsKeyboardCommandKey key={key} />
          }
          case SpecialKeys.macOS.alt: {
            return <MaterialSymbolsKeyboardOptionKey key={key} />
          }

          case SpecialKeys.macOS.ctrl: {
            return <MaterialSymbolsKeyboardControlKey key={key} />
          }

          case SpecialKeys.macOS.shift: {
            return <MaterialSymbolsShiftOutlineRounded key={key} />
          }

          case SharedKeys.tab: {
            return <MaterialSymbolsKeyboardTabRounded key={key} />
          }
          case SpecialKeys.Windows.meta: {
            return <MaterialSymbolsWindowOutlineSharp key={key} />
          }
          default: {
            return (
              <span className="capitalize" key={key}>
                {key}
              </span>
            )
          }
        }
      })}
    </kbd>
  )
})

function MaterialSymbolsKeyboardCommandKey(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M6.5 21q-1.45 0-2.475-1.025T3 17.5t1.025-2.475T6.5 14H8v-4H6.5q-1.45 0-2.475-1.025T3 6.5t1.025-2.475T6.5 3t2.475 1.025T10 6.5V8h4V6.5q0-1.45 1.025-2.475T17.5 3t2.475 1.025T21 6.5t-1.025 2.475T17.5 10H16v4h1.5q1.45 0 2.475 1.025T21 17.5t-1.025 2.475T17.5 21t-2.475-1.025T14 17.5V16h-4v1.5q0 1.45-1.025 2.475T6.5 21m0-2q.625 0 1.063-.437T8 17.5V16H6.5q-.625 0-1.062.438T5 17.5t.438 1.063T6.5 19m11 0q.625 0 1.063-.437T19 17.5t-.437-1.062T17.5 16H16v1.5q0 .625.438 1.063T17.5 19M10 14h4v-4h-4zM6.5 8H8V6.5q0-.625-.437-1.062T6.5 5t-1.062.438T5 6.5t.438 1.063T6.5 8M16 8h1.5q.625 0 1.063-.437T19 6.5t-.437-1.062T17.5 5t-1.062.438T16 6.5z"
      />
    </svg>
  )
}

function MaterialSymbolsKeyboardOptionKey(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path fill="currentColor" d="M14.775 19L7.85 7H3V5h6l6.925 12H21v2zM15 7V5h6v2z" />
    </svg>
  )
}

function MaterialSymbolsKeyboardControlKey(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path fill="currentColor" d="M6.4 13.4L5 12l7-7l7 7l-1.4 1.4L12 7.825z" />
    </svg>
  )
}

function MaterialSymbolsShiftOutlineRounded(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M8 20v-7H5.1q-.65 0-.912-.562t.137-1.063l6.9-8.425q.3-.375.775-.375t.775.375l6.9 8.425q.4.5.138 1.063T18.9 13H16v7q0 .425-.288.713T15 21H9q-.425 0-.712-.288T8 20m2-1h4v-8h2.775L12 5.15L7.225 11H10zm2-8"
      />
    </svg>
  )
}

function MaterialSymbolsKeyboardTabRounded(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M21 18q-.425 0-.712-.288T20 17V7q0-.425.288-.712T21 6t.713.288T22 7v10q0 .425-.288.713T21 18m-6.825-5H3q-.425 0-.712-.288T2 12t.288-.712T3 11h11.175L11.3 8.1q-.275-.275-.288-.687T11.3 6.7q.275-.275.7-.275t.7.275l4.6 4.6q.15.15.213.325t.062.375t-.062.375t-.213.325l-4.6 4.6q-.275.275-.687.275T11.3 17.3q-.3-.3-.3-.712t.3-.713z"
      />
    </svg>
  )
}

function MaterialSymbolsSpaceBarRounded(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M6 15q-.825 0-1.412-.587T4 13v-3q0-.425.288-.712T5 9t.713.288T6 10v3h12v-3q0-.425.288-.712T19 9t.713.288T20 10v3q0 .825-.587 1.413T18 15z"
      />
    </svg>
  )
}

export function IcOutlineBackspace(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m0 16H7.07L2.4 12l4.66-7H22zm-11.59-2L14 13.41L17.59 17L19 15.59L15.41 12L19 8.41L17.59 7L14 10.59L10.41 7L9 8.41L12.59 12L9 15.59z"
      />
    </svg>
  )
}

function MaterialSymbolsWindowOutlineSharp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M21 21H3V3h18zm-8-8v6h6v-6zm0-2h6V5h-6zm-2 0V5H5v6zm0 2H5v6h6z"
      />
    </svg>
  )
}
