#!/bin/bash

echo "=== Checking existing PRIVY_AUTHORIZATION_KEY ==="
echo ""

# Read the existing key from environment or you can paste it
if [ -f .env ]; then
    EXISTING_KEY=$(grep "PRIVY_AUTHORIZATION_KEY=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    
    if [ ! -z "$EXISTING_KEY" ]; then
        echo "Found existing key in .env file"
        echo ""
        
        # Detect format
        if [[ "$EXISTING_KEY" == "-----BEGIN"* ]]; then
            echo "✅ Format: PEM (with headers)"
            echo "Converting to base64 format..."
            echo "$EXISTING_KEY" > temp_private.pem
            openssl pkcs8 -topk8 -nocrypt -in temp_private.pem -outform DER | base64 > existing_key_base64.txt
            rm temp_private.pem
            
            # Extract public key
            echo "$EXISTING_KEY" > temp_private.pem
            openssl ec -in temp_private.pem -pubout -out existing_public.pem
            rm temp_private.pem
            
        elif [[ "$EXISTING_KEY" =~ ^[A-Za-z0-9+/=]{100,}$ ]]; then
            echo "✅ Format: Base64 (ready to use)"
            echo "$EXISTING_KEY" > existing_key_base64.txt
            
            # Try to convert to PEM first to extract public key
            echo "$EXISTING_KEY" | base64 -d > temp_private.der 2>/dev/null
            openssl pkcs8 -inform DER -nocrypt -in temp_private.der -out temp_private.pem 2>/dev/null
            if [ -f temp_private.pem ]; then
                openssl ec -in temp_private.pem -pubout -out existing_public.pem
                rm temp_private.pem temp_private.der
            else
                echo "Could not convert base64 to PEM. Please provide the key in PEM or DER format."
                rm temp_private.der
                exit 1
            fi
        else
            echo "❌ Unknown format. Please provide the key in PEM or base64 format."
            exit 1
        fi
        
        echo ""
        echo "=== PUBLIC KEY (Copy this for Privy Dashboard → Register key quorum) ==="
        cat existing_public.pem
        echo ""
        echo ""
        echo "=== PRIVATE KEY BASE64 (Already correct format) ==="
        cat existing_key_base64.txt
        echo ""
        echo ""
        echo "✅ Done! Use these values in your .env file"
        
    else
        echo "❌ No PRIVY_AUTHORIZATION_KEY found in .env file"
        echo "Please set it first, or paste your private key when prompted"
    fi
else
    echo "❌ No .env file found"
    echo "Please create one or paste your private key:"
fi

