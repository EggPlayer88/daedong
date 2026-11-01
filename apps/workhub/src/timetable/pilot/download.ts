export function downloadPilotText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const href = URL.createObjectURL(
    new Blob([type.startsWith('text/csv') && !text.startsWith('\ufeff') ? '\ufeff' : '', text], {
      type,
    }),
  )
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}
