from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

# Set up SQLite database
# Use data directory if it exists (for Docker deployments), otherwise current directory
import os
db_path = "data/chat.db" if os.path.exists("data") else "chat.db"
engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

# Base class for ORM models
Base = declarative_base()

# ORM model for chat messages
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)     # Auto-increment ID
    session_id = Column(String, index=True)                # Unique identifier for a chat session
    role = Column(String)                                  # "user" or "assistant"
    content = Column(Text)                                 # Message text
    created_at = Column(DateTime, default=datetime.utcnow) # Timestamp for each message

# Create the table if it doesn't exist
Base.metadata.create_all(bind=engine)

# Provide a database session to FastAPI endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()