import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { Icon, type IconName } from './Icon.tsx'

type Variant = 'primary' | 'default' | 'quiet' | 'danger'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: Variant
  readonly icon?: IconName
  readonly children?: ReactNode
  /** React 19 passes ref as an ordinary prop; no forwardRef wrapper needed. */
  readonly ref?: Ref<HTMLButtonElement>
}

const VARIANTS: Record<Variant, string> = {
  primary: 'kb-button kb-button--primary',
  default: 'kb-button',
  quiet: 'kb-button kb-button--quiet',
  danger: 'kb-button kb-button--danger',
}

/**
 * Elevation is declared once, as a border. The world uses hairlines rather
 * than shadows, so a button that grew a drop shadow would belong to a
 * different design.
 */
export function Button({ variant = 'default', icon, children, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${VARIANTS[variant]}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  )
}
