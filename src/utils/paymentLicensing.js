const DEFAULT_LICENSE_SERVICE_URL = 'https://vet-pos-licensing.clinicops-vet-ph.workers.dev'
const serviceUrl = `${import.meta.env.VITE_LICENSE_SERVICE_URL || DEFAULT_LICENSE_SERVICE_URL}`.trim().replace(/\/+$/, '')

export function isPaymentLicensingConfigured() {
  return Boolean(serviceUrl)
}

async function request(path, options = {}, timeoutMs = 15000) {
  if (!serviceUrl) throw new Error('Online payment licensing is not configured.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  const externalSignal = options.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason || 'cancelled')
  if (externalSignal?.aborted) abortFromExternal()
  else if (externalSignal) externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  let response
  try {
    response = await fetch(`${serviceUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
    let body
    try {
      body = await response.json()
    } catch (error) {
      throw new Error('The licensing service returned an invalid response.', { cause: error })
    }
    if (!response.ok) throw new Error(body.message || 'The licensing request failed.')
    return body
  } catch (error) {
    if (controller.signal.aborted) {
      if (externalSignal?.aborted) throw new Error('The licensing request was cancelled.', { cause: error })
      throw new Error('The licensing service took too long to respond. Check the connection and try again.', { cause: error })
    }
    if (response) throw error
    throw new Error('The licensing service could not be reached. Check the internet connection and try again.', { cause: error })
  } finally {
    clearTimeout(timeout)
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal)
  }
}

export function getPaymentConfig(signal) {
  return request('/api/config', { signal }, 10000)
}

export function submitPaymentRequest(details) {
  return request('/api/payment-requests', {
    method: 'POST',
    body: JSON.stringify(details),
  }, 20000)
}

export function checkPaymentRequest(requestId, claimToken) {
  return request(`/api/payment-requests/${encodeURIComponent(requestId)}/status`, {
    headers: { Authorization: `Bearer ${claimToken}` },
  }, 15000)
}
