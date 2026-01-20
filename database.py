from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
from zoneinfo import ZoneInfo
from env import DATABASE_URL, DB_SCHEMA

# Create engine using PostgreSQL
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Malaysia timezone
MALAYSIA_TZ = ZoneInfo("Asia/Kuala_Lumpur")

def malaysia_now():
    """Return current Malaysia time with tzinfo"""
    return datetime.now(MALAYSIA_TZ)

# Base class for ORM models
Base = declarative_base()

# ORM model for chat messages
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = {"schema": DB_SCHEMA}
    
    id = Column(Integer, primary_key=True, index=True) # Auto-increment ID
    session_id = Column(String, index=True) # Unique identifier for a chat session
    role = Column(String) # "user" or "assistant"
    content = Column(Text) # Message text
    created_at = Column(DateTime(timezone=True), default=malaysia_now) # Timestamp

# Create the table if it doesn't exist
Base.metadata.create_all(bind=engine)

# Provide a database session to FastAPI endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()