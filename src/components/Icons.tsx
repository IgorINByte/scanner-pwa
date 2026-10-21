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
export const CloseIcon = (p: P) => base(p, <path d="M6 6l12 12M18 6 6 18" />)
export const CheckIcon = (p: P) => base(p, <path d="m5 12 5 5 9-10" />)
export const PlusIcon = (p: P) => base(p, <path d="M12 5v14M5 12h14" />)
export const RotateIcon = (p: P) => base(p, <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>)
export const RotateLeftIcon = (p: P) => base(p, <><path d="M4 11a8 8 0 1 1 2.3 5.7" /><path d="M4 4v7h7" /></>)
export const TrashIcon = (p: P) =>
  base(p, <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>)
export const ShareIcon = (p: P) =>
  base(p, <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></>)
export const DownloadIcon = (p: P) =>
  base(p, <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>)
export const MailIcon = (p: P) => base(p, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>)
export const CropIcon = (p: P) => base(p, <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></>)
export const WandIcon = (p: P) =>
  base(p, <><path d="m15 4 5 5L9 20l-5-5z" /><path d="M14 5l5 5M5 3v3M3.5 4.5h3M19 15v3M17.5 16.5h3" /></>)
export const ExpandIcon = (p: P) => base(p, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />)
export const PagesIcon = (p: P) =>
  base(p, <><rect x="7" y="3" width="13" height="16" rx="2" /><path d="M4 7v12a2 2 0 0 0 2 2h10" /></>)
export const DocIcon = (p: P) =>
  base(p, <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>)
