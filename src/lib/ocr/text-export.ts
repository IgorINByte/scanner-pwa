// TXT and DOCX export of recognised text.
import type { Page } from '../../types'
import { pageOcrText } from '../storage/repository'

export function documentText(pages: Page[], withPageHeaders = true): string {
  return pages
    .map((p, i) => {
      const t = pageOcrText(p.ocr).trim()
      return withPageHeaders ? `--- Page ${i + 1} ---\n\n${t}` : t
    })
    .join('\n\n')
    .trim()
}

export function buildTxt(pages: Page[], name: string): File {
  // UTF-8 with BOM so Windows Notepad shows č/ć/đ/š/ž correctly.
  return new File(['﻿', documentText(pages)], `${name}.txt`, { type: 'text/plain;charset=utf-8' })
}

export async function buildDocx(pages: Page[], name: string): Promise<File> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
  const children = pages.flatMap((p, i) => {
    const text = pageOcrText(p.ocr).trim()
    const paras = text
      ? text.split(/\n{2,}/).map(
          (para) =>
            new Paragraph({
              children: para.split('\n').map((line, k) => new TextRun({ text: line, break: k > 0 ? 1 : 0 })),
              spacing: { after: 160 },
            }),
        )
      : [new Paragraph({ children: [new TextRun({ text: '(no text recognised)', italics: true, color: '888888' })] })]
    return [
      new Paragraph({ text: `Page ${i + 1}`, heading: HeadingLevel.HEADING_2, pageBreakBefore: i > 0 }),
      ...paras,
    ]
  })
  const doc = new Document({
    creator: 'Scanner PWA',
    title: name,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: [new Paragraph({ text: name, heading: HeadingLevel.TITLE }), ...children] }],
  })
  const blob = await Packer.toBlob(doc)
  return new File([blob], `${name}.docx`, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
