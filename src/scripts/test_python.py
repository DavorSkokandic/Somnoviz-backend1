#!/usr/bin/env python3
import sys
import json

def test_imports():
    try:
        import pyedflib
        print("✓ pyedflib imported successfully")
    except ImportError as e:
        print(f"✗ pyedflib import failed: {e}")
        return False
    
    try:
        import numpy
        print("✓ numpy imported successfully")
    except ImportError as e:
        print(f"✗ numpy import failed: {e}")
        return False
    
    try:
        import mne
        print("✓ mne imported successfully")
    except ImportError as e:
        print(f"✗ mne import failed: {e}")
        return False
    
    return True

if __name__ == "__main__":
    print("Testing Python dependencies...")
    success = test_imports()
    
    result = {
        "success": success,
        "python_version": sys.version,
        "message": "All dependencies available" if success else "Missing dependencies"
    }
    
    print(json.dumps(result)) 