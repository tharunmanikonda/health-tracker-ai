/**
 * Native Barcode Scanner Component
 * Uses react-native-vision-camera for native camera barcode scanning
 * Replaces WebView-based html5-qrcode which doesn't work on iOS WebView
 */

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {API_BASE_URL, STORAGE_KEYS} from '../utils/constants';

interface NativeBarcodeScannerProps {
  onClose: () => void;
  onFoodLogged?: () => void;
}

interface ScannedProduct {
  barcode: string;
  name: string;
  brand: string;
  image_url: string;
  serving_size: string;
  calories: number;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
  sodium: number;
  nutriscore_grade: string;
  nova_group: string;
}

export const NativeBarcodeScanner: React.FC<NativeBarcodeScannerProps> = ({
  onClose,
  onFoodLogged,
}) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isScanning, setIsScanning] = useState(true);

  const device = useCameraDevice('back');

  // Request camera permission on mount
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Code scanner configuration
  const codeScanner = useCodeScanner({
    codeTypes: [
      'ean-13',
      'ean-8',
      'upc-a',
      'upc-e',
      'code-128',
      'code-39',
      'qr',
      'itf-14',
    ],
    onCodeScanned: codes => {
      if (codes.length > 0 && isScanning && !loading && !scannedProduct) {
        const barcode = codes[0].value;
        if (barcode) {
          setIsScanning(false);
          lookupProduct(barcode);
        }
      }
    },
  });

  // Lookup product from OpenFoodFacts API v2
  const lookupProduct = async (barcode: string) => {
    setLoading(true);
    setError(null);

    try {
      const apiFields =
        'product_name,generic_name,brands,image_url,image_front_url,serving_size,serving_quantity,nutriments,nutriscore_grade,nova_group';
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${apiFields}`,
      );
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = data.product;
        const nutriments = product.nutriments || {};

        const servingSize = parseFloat(product.serving_quantity) || 100;
        const multiplier = servingSize / 100;

        const kcalPer100 =
          nutriments['energy-kcal_100g'] ??
          nutriments['energy-kcal'] ??
          (nutriments['energy_100g'] != null
            ? nutriments['energy_100g'] / 4.184
            : 0);

        setScannedProduct({
          barcode,
          name:
            product.product_name ||
            product.generic_name ||
            'Unknown Product',
          brand: product.brands?.split(',')[0] || '',
          image_url: product.image_url || product.image_front_url || '',
          serving_size: product.serving_size || '100g',
          calories: Math.round((kcalPer100 ?? 0) * multiplier),
          protein: ((nutriments.proteins_100g ?? 0) * multiplier).toFixed(1),
          carbs: (
            (nutriments.carbohydrates_100g ?? 0) * multiplier
          ).toFixed(1),
          fat: ((nutriments.fat_100g ?? 0) * multiplier).toFixed(1),
          fiber: ((nutriments.fiber_100g ?? 0) * multiplier).toFixed(1),
          sugar: ((nutriments.sugars_100g ?? 0) * multiplier).toFixed(1),
          sodium: Math.round(
            (nutriments.sodium_100g ?? 0) * multiplier * 1000,
          ),
          nutriscore_grade: product.nutriscore_grade || '',
          nova_group: product.nova_group || '',
        });
      } else {
        setError(`Product not found (${barcode})`);
        setTimeout(() => {
          setError(null);
          setIsScanning(true);
        }, 3000);
      }
    } catch (_err) {
      setError('Failed to lookup product - check connection');
      setTimeout(() => {
        setError(null);
        setIsScanning(true);
      }, 3000);
    } finally {
      setLoading(false);
    }
  };

  // Log food to backend
  const logProduct = async () => {
    if (!scannedProduct) return;

    setLoading(true);
    setError(null);
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/food/log`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...scannedProduct,
          source: 'barcode',
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Server error ${response.status}`);
      }

      setSuccess(true);
      setTimeout(() => {
        onFoodLogged?.();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to log food');
      setLoading(false);
    }
  };

  // Reset to scanning state
  const resetScanner = () => {
    setScannedProduct(null);
    setSuccess(false);
    setError(null);
    setIsScanning(true);
    setLoading(false);
  };

  // --- Render: No Permission ---
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Camera Permission Required</Text>
          <Text style={styles.errorSubtext}>
            Please allow camera access in Settings to scan barcodes.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Render: No Camera Device ---
  if (!device) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>No Camera Available</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Render: Success ---
  if (success) {
    return (
      <View style={[styles.container, {backgroundColor: '#10B981'}]}>
        <View style={styles.centered}>
          <View style={styles.successCircle}>
            <Text style={styles.successCheck}>✓</Text>
          </View>
          <Text style={styles.successTitle}>Food Logged!</Text>
        </View>
      </View>
    );
  }

  // --- Render: Product Result ---
  if (scannedProduct) {
    return (
      <View style={[styles.container, {backgroundColor: '#fff'}]}>
        {/* Fixed Header - below status bar, outside ScrollView */}
        <View style={styles.productHeader}>
          <TouchableOpacity
            onPress={resetScanner}
            style={styles.headerButton}
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <Text style={styles.backButton}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Product Details</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.headerButton}
            hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.productContainer}>

          {/* Product Image */}
          {scannedProduct.image_url ? (
            <Image
              source={{uri: scannedProduct.image_url}}
              style={styles.productImage}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.productImage, styles.placeholderImage]}>
              <Text style={styles.placeholderText}>No Image</Text>
            </View>
          )}

          {/* Product Info */}
          <Text style={styles.productName}>{scannedProduct.name}</Text>
          {scannedProduct.brand ? (
            <Text style={styles.productBrand}>{scannedProduct.brand}</Text>
          ) : null}
          <Text style={styles.productServing}>
            {scannedProduct.serving_size}
          </Text>

          {/* Nutrition Grid */}
          <View style={styles.nutritionGrid}>
            <View style={[styles.nutriCard, {backgroundColor: '#FEF3C7'}]}>
              <Text style={styles.nutriValue}>{scannedProduct.calories}</Text>
              <Text style={styles.nutriLabel}>Cal</Text>
            </View>
            <View style={[styles.nutriCard, {backgroundColor: '#DBEAFE'}]}>
              <Text style={styles.nutriValue}>
                {scannedProduct.protein}g
              </Text>
              <Text style={styles.nutriLabel}>Protein</Text>
            </View>
            <View style={[styles.nutriCard, {backgroundColor: '#FEE2E2'}]}>
              <Text style={styles.nutriValue}>{scannedProduct.carbs}g</Text>
              <Text style={styles.nutriLabel}>Carbs</Text>
            </View>
            <View style={[styles.nutriCard, {backgroundColor: '#F3E8FF'}]}>
              <Text style={styles.nutriValue}>{scannedProduct.fat}g</Text>
              <Text style={styles.nutriLabel}>Fat</Text>
            </View>
          </View>

          {/* Nutri-Score */}
          {scannedProduct.nutriscore_grade ? (
            <View style={styles.nutriscoreRow}>
              <Text style={styles.nutriscoreLabel}>Nutri-Score: </Text>
              <View style={styles.nutriscoreBadge}>
                <Text style={styles.nutriscoreGrade}>
                  {scannedProduct.nutriscore_grade.toUpperCase()}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.logButton}
              onPress={logProduct}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.logButtonText}>+ Log Food</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={resetScanner}>
              <Text style={styles.cancelButtonText}>Scan Again</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
      </View>
    );
  }

  // --- Render: Camera Scanner ---
  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isScanning && !loading}
        codeScanner={codeScanner}
      />

      {/* Overlay UI */}
      <View style={styles.overlay}>
        {/* Top bar - with safe area padding */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.topBarButton}>
            <Text style={styles.topBarButtonText}>✕ Close</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Scan Barcode</Text>
          <View style={{width: 70}} />
        </View>

        {/* Scan frame */}
        <View style={styles.scanFrameContainer}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>

        {/* Status */}
        <View style={styles.statusContainer}>
          {loading ? (
            <View style={styles.statusBadge}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.statusText}>Looking up product...</Text>
            </View>
          ) : error ? (
            <View
              style={[
                styles.statusBadge,
                {backgroundColor: 'rgba(239, 68, 68, 0.9)'},
              ]}>
              <Text style={styles.statusText}>{error}</Text>
            </View>
          ) : (
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>Point camera at barcode</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');
const SCAN_FRAME_SIZE = SCREEN_WIDTH * 0.75;
// iOS status bar + notch safe area
const TOP_INSET = Platform.OS === 'ios' ? 59 : (StatusBar.currentHeight || 24);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: TOP_INSET,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  topBarButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  topBarButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  topBarTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scanFrameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: SCAN_FRAME_SIZE,
    height: SCAN_FRAME_SIZE * 0.55,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#0EA5E9',
    borderWidth: 3,
  },
  cornerTL: {top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0},
  cornerTR: {top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0},
  cornerBL: {bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0},
  cornerBR: {bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0},
  statusContainer: {
    alignItems: 'center',
    paddingBottom: 60,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingTop: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(14, 165, 233, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  // Product screen
  productContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: TOP_INSET + 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#fff',
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  backButton: {
    fontSize: 16,
    color: '#0EA5E9',
    fontWeight: '600',
  },
  closeText: {
    fontSize: 22,
    color: '#6B7280',
    fontWeight: '400',
    textAlign: 'right',
  },
  productImage: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: '#F3F4F6',
  },
  placeholderImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#9CA3AF',
    fontSize: 16,
  },
  productName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  productBrand: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 4,
  },
  productServing: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 20,
  },
  nutritionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  nutriCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  nutriValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  nutriLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  nutriscoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  nutriscoreLabel: {
    fontSize: 15,
    color: '#374151',
  },
  nutriscoreBadge: {
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  nutriscoreGrade: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  logButton: {
    flex: 1,
    backgroundColor: '#0EA5E9',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#EF4444',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: '#0EA5E9',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  successCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successCheck: {
    color: '#fff',
    fontSize: 40,
    fontWeight: 'bold',
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#10B981',
  },
});

export default NativeBarcodeScanner;
