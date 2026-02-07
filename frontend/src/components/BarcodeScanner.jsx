import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { 
  Scan, Check, X, Loader2, Sparkles, ArrowLeft,
  Flame, Dumbbell, Wheat as WheatIcon, Droplets,
  Plus, Camera, Flashlight, RefreshCw, AlertCircle
} from 'lucide-react'
import axios from 'axios'

function BarcodeScanner() {
  const [scannedProduct, setScannedProduct] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [showStartButton, setShowStartButton] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [debug, setDebug] = useState('')
  const [scanningBarcode, setScanningBarcode] = useState(null)
  
  const html5QrCodeRef = useRef(null)

  const startScanner = async () => {
    setDebug('Starting scanner...')
    setShowStartButton(false)
    setError(null)
    
    try {
      // Check if camera permission is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Camera not supported on this device/browser')
        setShowStartButton(true)
        return
      }

      setDebug('Requesting camera permission...')
      
      // First request permission explicitly
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      })
      
      // Stop the stream - we just needed permission
      stream.getTracks().forEach(track => track.stop())
      
      setDebug('Permission granted, initializing scanner...')
      
      // Initialize Html5Qrcode with barcode formats in constructor (required by API)
      html5QrCodeRef.current = new Html5Qrcode('reader', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.ITF,
        ],
        // Disable native BarcodeDetector - has format mapping bugs in Chrome
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: false
        },
        verbose: false,
      })

      const config = {
        fps: 10,
        qrbox: { width: 300, height: 150 },
        aspectRatio: 1.777,
        disableFlip: false,
      }

      setDebug('Starting camera...')
      
      await html5QrCodeRef.current.start(
        { facingMode: 'environment' },
        config,
        (decodedText, decodedResult) => {
          console.log('[OK] BARCODE DETECTED:', decodedText, decodedResult)
          setDebug('DETECTED: ' + decodedText)
          handleScan(decodedText)
        },
        (errorMessage) => {
          // Silent fail during scanning - this is normal
          // Only log every 100th error to avoid spam
          if (Math.random() < 0.001) {
            console.log('Scanning... (no barcode yet)')
          }
        }
      )

      setDebug('Camera started successfully!')
      setCameraReady(true)
      
      if (navigator.vibrate) navigator.vibrate(50)
      
      // Add visible feedback for scanning
      const feedbackInterval = setInterval(() => {
        if (html5QrCodeRef.current) {
          setDebug('Point camera at barcode...')
        }
      }, 3000)

      // Store interval for cleanup
      window._barcodeScannerInterval = feedbackInterval
      
    } catch (err) {
      console.error('Camera error:', err)
      setDebug('Error: ' + err.message)
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true)
      } else {
        setError('Camera failed: ' + err.message)
        setShowStartButton(true)
      }
    }
  }

  const stopScanner = async () => {
    if (window._barcodeScannerInterval) {
      clearInterval(window._barcodeScannerInterval)
      window._barcodeScannerInterval = null
    }
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop()
        await html5QrCodeRef.current.clear()
      } catch (e) {
        // Ignore cleanup errors
      }
      html5QrCodeRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [])

  const handleScan = async (decodedText) => {
    if (loading || scannedProduct) return
    
    setScanningBarcode(decodedText)
    setLoading(true)
    setError(null)
    
    if (navigator.vibrate) navigator.vibrate(50)
    
    // Pause scanner while processing
    if (html5QrCodeRef.current) {
      try {
        html5QrCodeRef.current.pause(true)
      } catch (e) {}
    }
    
    try {
      // Use OpenFoodFacts API v2 with specific fields for faster response
      const apiFields = 'product_name,generic_name,brands,image_url,image_front_url,serving_size,serving_quantity,nutriments,nutriscore_grade,nova_group'
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${decodedText}?fields=${apiFields}`
      )
      const data = await response.json()

      if (data.status === 1 && data.product) {
        const product = data.product
        const nutriments = product.nutriments || {}

        const servingSize = parseFloat(product.serving_quantity) || 100
        const multiplier = servingSize / 100

        // Use ?? (nullish coalescing) so 0 values aren't skipped
        const kcalPer100 = nutriments['energy-kcal_100g']
          ?? nutriments['energy-kcal']
          ?? (nutriments['energy_100g'] != null ? nutriments['energy_100g'] / 4.184 : 0)

        setScannedProduct({
          barcode: decodedText,
          name: product.product_name || product.generic_name || 'Unknown Product',
          brand: product.brands?.split(',')[0] || '',
          image_url: product.image_url || product.image_front_url || '',
          serving_size: product.serving_size || '100g',
          calories: Math.round((kcalPer100 ?? 0) * multiplier),
          protein: ((nutriments.proteins_100g ?? 0) * multiplier).toFixed(1),
          carbs: ((nutriments.carbohydrates_100g ?? 0) * multiplier).toFixed(1),
          fat: ((nutriments.fat_100g ?? 0) * multiplier).toFixed(1),
          fiber: ((nutriments.fiber_100g ?? 0) * multiplier).toFixed(1),
          sugar: ((nutriments.sugars_100g ?? 0) * multiplier).toFixed(1),
          sodium: Math.round((nutriments.sodium_100g ?? 0) * multiplier * 1000),
          nutriscore_grade: product.nutriscore_grade || '',
          nova_group: product.nova_group || ''
        })

        if (navigator.vibrate) navigator.vibrate([50, 100, 50])
      } else {
        setError(`Product not found (${decodedText})`)
        setTimeout(() => {
          setError(null)
          setScanningBarcode(null)
          if (html5QrCodeRef.current) {
            try { html5QrCodeRef.current.resume() } catch (e) {}
          }
        }, 3000)
      }
    } catch (err) {
      console.error('API lookup failed:', err)
      setError('Failed to lookup product - check connection')
      setTimeout(() => {
        setError(null)
        setScanningBarcode(null)
        if (html5QrCodeRef.current) {
          try { html5QrCodeRef.current.resume() } catch (e) {}
        }
      }, 3000)
    } finally {
      setLoading(false)
    }
  }

  const logProduct = async () => {
    if (!scannedProduct) return
    
    setLoading(true)
    try {
      await axios.post('/api/food/log', {
        ...scannedProduct,
        source: 'barcode'
      })
      setSuccess(true)
      if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      setTimeout(() => {
        resetScanner()
      }, 2000)
    } catch (err) {
      setError('Failed to log food')
      setLoading(false)
    }
  }

  const resetScanner = () => {
    setScannedProduct(null)
    setSuccess(false)
    setError(null)
    setDebug('')
    setScanningBarcode(null)
    stopScanner().then(() => {
      setShowStartButton(true)
      setCameraReady(false)
    })
  }

  const getHealthScore = (product) => {
    if (!product) return 0
    let score = 50
    if (product.protein > 20) score += 20
    if (product.fiber > 5) score += 15
    if (product.sugar < 10) score += 15
    if (product.calories < 300) score += 10
    return Math.min(score, 100)
  }

  // Manual barcode entry component
  function ManualEntry() {
    const [manualCode, setManualCode] = useState('')
    
    const submitManual = (e) => {
      e.preventDefault()
      if (manualCode.trim()) {
        handleScan(manualCode.trim())
      }
    }
    
    return (
      <form onSubmit={submitManual} style={{marginTop: '2rem', width: '100%', maxWidth: '300px'}}>
        <p style={{color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.75rem'}}>
          Or enter barcode manually:
        </p>
        <div style={{display: 'flex', gap: '0.5rem'}}>
          <input 
            type="text" 
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Enter barcode number"
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'white',
              fontSize: '1rem'
            }}
          />
          <button 
            type="submit"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent)',
              color: '#000',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Go
          </button>
        </div>
      </form>
    )
  }

  if (scannedProduct) {
    return (
      <div className="scanner-result">
        {success ? (
          <div className="success-screen">
            <div className="success-circle">
              <Check size={48} />
            </div>
            <h2>Food Logged!</h2>
          </div>
        ) : (
          <>
            <div className="result-header">
              <button onClick={resetScanner}><ArrowLeft size={24} /></button>
              <div className="health-score" style={{
                '--score': getHealthScore(scannedProduct),
                '--color': getHealthScore(scannedProduct) > 70 ? '#10b981' : 
                           getHealthScore(scannedProduct) > 40 ? '#f59e0b' : '#ef4444'
              }}>
                <span>{getHealthScore(scannedProduct)}</span>
              </div>
            </div>

            <div className="product-image">
              {scannedProduct.image_url ? (
                <img src={scannedProduct.image_url} alt={scannedProduct.name} />
              ) : (
                <div className="placeholder"><Sparkles size={40} /></div>
              )}
            </div>

            <div className="product-details">
              <h2>{scannedProduct.name}</h2>
              {scannedProduct.brand && <p className="brand">{scannedProduct.brand}</p>}
              <p className="serving">{scannedProduct.serving_size}</p>
            </div>

            <div className="nutrition-grid">
              <div className="nutri-card cal">
                <Flame size={20} />
                <span className="value">{scannedProduct.calories}</span>
                <span className="label">Cal</span>
              </div>
              <div className="nutri-card pro">
                <Dumbbell size={20} />
                <span className="value">{scannedProduct.protein}g</span>
                <span className="label">Protein</span>
              </div>
              <div className="nutri-card carb">
                <WheatIcon size={20} />
                <span className="value">{scannedProduct.carbs}g</span>
                <span className="label">Carbs</span>
              </div>
              <div className="nutri-card fat">
                <Droplets size={20} />
                <span className="value">{scannedProduct.fat}g</span>
                <span className="label">Fat</span>
              </div>
            </div>

            {scannedProduct.nutriscore_grade && (
              <div className="nutriscore">
                Nutri-Score: <span className={`grade grade-${scannedProduct.nutriscore_grade}`}>
                  {scannedProduct.nutriscore_grade.toUpperCase()}
                </span>
              </div>
            )}

            <div className="action-buttons">
              <button className="btn-log" onClick={logProduct} disabled={loading}>
                {loading ? <Loader2 className="spin" size={20} /> : <Plus size={20} />}
                Log Food
              </button>
              <button className="btn-cancel" onClick={resetScanner}>
                <X size={24} />
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="scanner-page">
      <div className="scanner-header">
        <button onClick={() => window.history.back()}><ArrowLeft size={24} /></button>
        <h1>Scan Product</h1>
        <div style={{width: 40}} />
      </div>

      <div className="scanner-viewport">
        {showStartButton ? (
          <div className="start-overlay">
            <Camera size={48} />
            <h3>Camera Access Required</h3>
            <p>Allow camera to scan barcodes</p>
            <button className="btn-start" onClick={startScanner}>
              <Camera size={20} />
              Start Camera
            </button>
            <ManualEntry />
            {debug && <p className="debug">{debug}</p>}
          </div>
        ) : permissionDenied ? (
          <div className="start-overlay">
            <AlertCircle size={48} color="#ef4444" />
            <h3>Camera Access Denied</h3>
            <p>Please enable camera in browser settings</p>
            <button className="btn-start" onClick={() => window.location.reload()}>
              Try Again
            </button>
          </div>
        ) : (
          <>
            <div id="reader" />
            
            <div className="scan-frame">
              <div className="corner tl" /><div className="corner tr" />
              <div className="corner bl" /><div className="corner br" />
              {cameraReady && <div className="scan-line" />}
            </div>

            <div className="scan-status">
              {loading ? (
                <span className="status loading">
                  <Loader2 className="spin" size={16} /> 
                  {scanningBarcode ? `Found: ${scanningBarcode}` : 'Looking up...'}
                </span>
              ) : error ? (
                <span className="status error"><X size={16} /> {error}</span>
              ) : (
                <span className="status ready"><Camera size={16} /> Ready to scan</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default BarcodeScanner
