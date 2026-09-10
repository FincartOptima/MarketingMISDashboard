# PythonAnywhere WSGI entry point.
#
# Setup (in the PythonAnywhere Web tab):
#   1. Create a new web app -> Manual configuration -> Python 3.10.
#   2. Set "Source code" to /home/Fincart/marketing-mis/backend
#   3. Copy the contents of this file into the WSGI configuration file
#      PythonAnywhere gives you (Web tab -> WSGI configuration file link).
#   4. Set UPLOAD_PASSWORD as an environment variable in the Web tab
#      ("Environment variables" section), or hardcode it below.
#   5. For the live BD Accountability Tracker sync (see README_BD_SYNC.md),
#      set GOOGLE_SERVICE_ACCOUNT_JSON in the Web tab's "Environment
#      variables" section to the full contents of the service account's
#      JSON key file (one line). BD_SHEET_ID only needs setting if the
#      tracker ever moves to a different spreadsheet.
import sys
import os

path = '/home/Fincart/marketing-mis/backend'
if path not in sys.path:
    sys.path.insert(0, path)

os.environ.setdefault('UPLOAD_PASSWORD', 'Password')

from app import app as application
