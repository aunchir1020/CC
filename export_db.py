import os
import shutil
import tempfile
from datetime import datetime

# Reuse the database path from the main database module
from database import db_path


def create_db_export() -> tuple[str, str]:
    """
    Create a copy of the SQLite database that can be downloaded.

    Returns:
        (export_path, filename)
    """
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"Database file not found at: {db_path}")

    # Generate a timestamped filename for the export
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"chat_db_export_{timestamp}.sqlite"

    # Place the temporary copy in the system temp directory
    export_path = os.path.join(tempfile.gettempdir(), filename)

    # Copy the SQLite file so we never touch the live DB file directly
    shutil.copy2(db_path, export_path)

    return export_path, filename