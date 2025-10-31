#!/bin/bash

PRIVATE_KEY_BASE64="MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpfHMqx7tIUSQoRXTLbRMl"

echo "$PRIVATE_KEY_BASE64" | base64 -d > temp_private_key.der
openssl pkcs8 -inform DER -nocrypt -in temp_private_key.der -out temp_private.pem 2>/dev/null
openssl ec -in temp_private.pem -pubout -out public.pem 2>/dev/null

if [ -f public.pem ]; then
    echo "=== PUBLIC KEY (Copy this for Privy Dashboard) ==="
    cat public.pem
    echo ""
    echo "✅ Success! Copy the public key above"
    
    # Clean up
    rm -f temp_private_key.der temp_private.pem
else
    echo "❌ Error: Could not extract public key"
    rm -f temp_private_key.der temp_private.pem
    exit 1
fi
