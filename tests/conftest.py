"""
Shared pytest fixtures for all test modules
"""

import pytest
import os
import tempfile
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base, ChatMessage, SessionLocal
from api import app, count_tokens
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db():
    """Create a temporary database for testing"""
    # Create a temporary database file
    db_fd, db_path = tempfile.mkstemp(suffix='.db')
    os.close(db_fd)
    
    # Create engine and session for temporary DB
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    
    yield TestSessionLocal, db_path
    
    # Cleanup: remove temporary database file
    if os.path.exists(db_path):
        os.remove(db_path)


@pytest.fixture
def test_session_id():
    """Generate a unique session ID for each test"""
    return str(uuid.uuid4())


@pytest.fixture
def client():
    """Create a test client for FastAPI"""
    return TestClient(app)


@pytest.fixture
def sample_short_message():
    """A short message that fits within token limits"""
    return "Hello, how are you?"


@pytest.fixture
def sample_long_message():
    """A message that exceeds 400 tokens"""
    # Create a message that's definitely over 1200 tokens
    # Each word is approximately 1 token, so we need 1200+ words
    words = ["word"] * 1300
    return " ".join(words)


@pytest.fixture
def sample_medium_message():
    """A medium-length message within token limits"""
    return "This is a medium length message that should be well within the token limit. " * 5