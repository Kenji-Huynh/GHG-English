import Swal from 'sweetalert2'
import { larkErrorHtml, isLarkApiError } from './larkError.js'

const toastMixin = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: true,
})

/** @param {string} msg */
export function toastOk(msg) {
  return toastMixin.fire({ icon: 'success', title: msg })
}

/** @param {string} msg */
export function toastErr(msg) {
  return toastMixin.fire({ icon: 'error', title: msg })
}

/**
 * Show detailed error modal — with URL / Lark code / HTTP; also logs to F12 → Console.
 * @param {unknown} err
 * @param {string} [shortTitle]
 */
export function showErrorDetail(err, shortTitle = 'Lark sync error') {
  const e = err instanceof Error ? err : new Error(String(err))
  console.error(`[${shortTitle}]`, e, isLarkApiError(err) ? err.details : undefined)

  const title =
    e.message.length > 100 ? `${e.message.slice(0, 97)}…` : e.message || shortTitle

  return Swal.fire({
    icon: 'error',
    title: shortTitle,
    html: `<p style="margin:0 0 10px;font-size:14px;text-align:left"><strong>${title}</strong></p>${larkErrorHtml(err)}`,
    confirmButtonText: 'Close',
    width: 640,
    customClass: { htmlContainer: 'lark-error-swal' },
  })
}

/**
 * @param {string} title
 * @param {string} [text]
 * @param {string} [confirmText]
 */
export async function confirmDanger(title, text = '', confirmText = 'Delete') {
  const r = await Swal.fire({
    icon: 'warning',
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#C0392B',
    cancelButtonColor: '#6B6960',
    reverseButtons: true,
  })
  return r.isConfirmed
}

/**
 * @param {string} title
 * @param {string} [text]
 */
export async function confirmAction(title, text = '') {
  const r = await Swal.fire({
    icon: 'question',
    title,
    text,
    showCancelButton: true,
    confirmButtonText: 'Confirm',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#1A6B3C',
    cancelButtonColor: '#6B6960',
    reverseButtons: true,
  })
  return r.isConfirmed
}

/**
 * @param {string} title
 * @param {string} html
 */
export function alertInfo(title, html) {
  return Swal.fire({ icon: 'info', title, html, confirmButtonText: 'Got it' })
}
