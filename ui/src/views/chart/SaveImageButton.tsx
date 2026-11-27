import { save } from '@tauri-apps/plugin-dialog'
import { useState, type RefObject } from 'react'
import { commands } from '../../bindings'
import { toMessage } from '../../lib/errors'
import { activeQueryStore } from '../../query/queryStore'
import type { ChartCanvasHandle } from './ChartCanvas'

type Props = {
  canvas: RefObject<ChartCanvasHandle | null>
  /** `false` while the view shows no chart, for example for a single value. */
  isAvailable: boolean
}

function notify(text: string): void {
  activeQueryStore().getState().setNotice(text)
}

/**
 * Saves an image of the chart to a file that the user selects. The extension of
 * the file name selects the format: PNG, or SVG for an image that has no pixels.
 */
export function SaveImageButton({ canvas, isAvailable }: Props) {
  const [isBusy, setIsBusy] = useState(false)

  const run = async () => {
    try {
      const path = await save({
        defaultPath: 'chart.png',
        filters: [
          { name: 'PNG image', extensions: ['png'] },
          { name: 'SVG image', extensions: ['svg'] },
        ],
      })
      if (!path || !canvas.current) return
      setIsBusy(true)
      const format = path.toLowerCase().endsWith('.svg') ? 'svg' : 'png'
      const image = await canvas.current.exportImage(format)
      const result = await commands.viewImageSave(path, image)
      notify(
        result.status === 'error'
          ? `The image export failed: ${result.error.message}`
          : `Saved the image of the chart to ${path}.`,
      )
    } catch (error) {
      notify(`The image export failed: ${toMessage(error)}`)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <button
      type="button"
      className="button button--small"
      disabled={!isAvailable || isBusy}
      title="Saves the chart as a PNG image or an SVG image. The image has the rows that the chart shows."
      onClick={() => void run()}
    >
      {isBusy ? 'Saving…' : 'Save image…'}
    </button>
  )
}
