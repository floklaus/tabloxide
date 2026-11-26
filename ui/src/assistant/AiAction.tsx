import { Icon } from '../shell/icons'
import { runAiAction, type ActionRequest } from './assistantStore'

type Props = {
  label: string
  /** Makes the request when the user selects the button. */
  request: () => ActionRequest
  disabled?: boolean
  /** The reason why the action is not available, or an explanation. */
  title?: string
  className?: string
}

/**
 * The button of an AI action. A sparkle icon in the accent colour marks it. The
 * answer goes to the assistant panel.
 */
export function AiAction({
  label,
  request,
  disabled = false,
  title,
  className = 'button button--small',
}: Props) {
  return (
    <button
      type="button"
      className={`${className} ai-action`}
      disabled={disabled}
      title={title}
      onClick={() => void runAiAction(request())}
    >
      <Icon name="sparkle" size={14} />
      {label}
    </button>
  )
}
