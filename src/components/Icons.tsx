import type { ReactNode, SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (props: P, children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={22}
    height={22}
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
)

export const CameraIcon = (p: P) =>
  base(p, <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>)
export const ImageIcon = (p: P) =>
  base(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>)
export const BackIcon = (p: P) => base(p, <path d="M15 18l-6-6 6-6" />)
export const ChevronRightIcon = (p: P) => base(p, <path d="m9 18 6-6-6-6" />)
export const ChevronDownIcon = (p: P) => base(p, <path d="m6 9 6 6 6-6" />)
export const CloseIcon = (p: P) => base(p, <path d="M6 6l12 12M18 6 6 18" />)
export const CheckIcon = (p: P) => base(p, <path d="m5 12 5 5 9-10" />)
export const PlusIcon = (p: P) => base(p, <path d="M12 5v14M5 12h14" />)
export const RotateIcon = (p: P) => base(p, <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>)
export const RotateLeftIcon = (p: P) => base(p, <><path d="M4 11a8 8 0 1 1 2.3 5.7" /><path d="M4 4v7h7" /></>)
export const TrashIcon = (p: P) => base(p, <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />)
export const ShareIcon = (p: P) =>
  base(p, <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>)
export const DownloadIcon = (p: P) => base(p, <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>)
export const MailIcon = (p: P) => base(p, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>)
export const CropIcon = (p: P) => base(p, <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>)
export const WandIcon = (p: P) =>
  base(p, <><path d="m15 4 5 5L9 20l-5-5z" /><path d="M14 5l5 5M5 3v3M3.5 4.5h3M19 15v3M17.5 16.5h3" /></>)
export const ExpandIcon = (p: P) => base(p, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />)
export const PagesIcon = (p: P) => base(p, <><rect x="7" y="3" width="13" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h10" /></>)
export const DocIcon = (p: P) => base(p, <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>)
export const PdfIcon = (p: P) =>
  base(p, <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /><path d="M9 17v-4h1.5a1.5 1.5 0 0 1 0 3H9" /></>)
export const UndoIcon = (p: P) => base(p, <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>)
export const RedoIcon = (p: P) => base(p, <><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>)
export const FolderIcon = (p: P) => base(p, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const SearchIcon = (p: P) => base(p, <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>)
export const MoreIcon = (p: P) =>
  base(p, <><circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>)
export const SlidersIcon = (p: P) =>
  base(p, <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>)
export const TextIcon = (p: P) => base(p, <path d="M5 6V4h14v2M12 4v16M9 20h6" />)
export const PenIcon = (p: P) => base(p, <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>)
export const HighlighterIcon = (p: P) =>
  base(p, <><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>)
export const UnderlineIcon = (p: P) => base(p, <><path d="M6 4v6a6 6 0 0 0 12 0V4" /><path d="M4 20h16" /></>)
export const SquareIcon = (p: P) => base(p, <rect x="4" y="4" width="16" height="16" rx="1" />)
export const EraserIcon = (p: P) =>
  base(p, <><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" /><path d="M22 21H7M5 11l9 9" /></>)
export const CursorIcon = (p: P) => base(p, <path d="m4 4 7 17 2.5-7.5L21 11z" />)
export const SignatureIcon = (p: P) =>
  base(p, <><path d="M3 17c3-1 4-9 6-9s-1 9 1 9 3-5 5-5 1 4 3 4 2-2 3-2" /><path d="M3 21h18" /></>)
export const StampIcon = (p: P) =>
  base(p, <><path d="M5 22h14M5 18h14v-3a2 2 0 0 0-2-2h-3V9a3 3 0 1 0-4 0v4H7a2 2 0 0 0-2 2z" /></>)
export const CopyIcon = (p: P) => base(p, <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>)
export const DuplicateIcon = CopyIcon
export const CompareIcon = (p: P) => base(p, <><path d="M12 3v18" /><rect x="3" y="5" width="18" height="14" rx="2" /></>)
export const OcrIcon = (p: P) =>
  base(p, <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 9h8M8 12h8M8 15h5" /></>)
export const SplitIcon = (p: P) => base(p, <><path d="M12 3v18M8 7 4 12l4 5M16 7l4 5-4 5" /></>)
export const SettingsIcon = (p: P) =>
  base(p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const LockIcon = (p: P) => base(p, <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
export const EyeIcon = (p: P) => base(p, <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
export const ResetIcon = (p: P) => base(p, <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>)
export const SelectIcon = (p: P) => base(p, <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="m15 17 2 2 4-4" /></>)
export const InfoIcon = (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h0" /></>)
export const AlertIcon = (p: P) => base(p, <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h0" /></>)
