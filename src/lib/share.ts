export function canShareFiles(files: File[]) {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files })
  } catch {
    return false
  }
}

/**
 * Opens the system share sheet. Must be called directly from a click handler
 * (iOS Safari rejects share() once the user gesture has expired), so files
 * have to be generated beforehand.
 * Returns false if the user cancelled.
 */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  try {
    await navigator.share({ files, title })
    return true
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false
    throw e
  }
}

export async function downloadFiles(files: File[]) {
  for (const [i, file] of files.entries()) {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    // Browsers block rapid-fire multiple downloads; space them out.
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, 400))
  }
}

export function mailtoHref(name: string, fileNames: string[]) {
  const subject = encodeURIComponent(name)
  const body = encodeURIComponent(
    `Hi,\n\nPlease find the scanned document attached (${fileNames.join(', ')}).\n\n`,
  )
  return `mailto:?subject=${subject}&body=${body}`
}
