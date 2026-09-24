"""
CompliLens Database Connection Management.
Supports PostgreSQL 15+ via SQLAlchemy with automatic fallback to SQLite
for local execution when PostgreSQL/Docker is not running.
"""
import os
import logging
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

logger = logging.getLogger("complilens.database")

Base = declarative_base()

DATA_DIR = Path(__file__).parent.parent.parent / "data"
SQLITE_DB_PATH = DATA_DIR / "complilens.db"

def get_database_engine():
    """
    Initializes and returns the database engine.
    Tries PostgreSQL if configured via DATABASE_URL or localhost,
    and falls back gracefully to SQLite so local developers are never blocked.
    """
    db_url = os.environ.get("DATABASE_URL")
    
    # 1. If explicit DATABASE_URL provided (e.g. docker-compose or production)
    if db_url:
        try:
            engine = create_engine(db_url, pool_pre_ping=True)
            with engine.connect() as conn:
                logger.info(f"Connected successfully to configured database: {engine.url.render_as_string(hide_password=True)}")
            return engine
        except Exception as e:
            logger.warning(f"Could not connect to configured DATABASE_URL ({e}). Falling back to local database.")

    # 2. Try default local PostgreSQL on port 5433 (docker) or 5432 (default)
    for port in (5433, 5432):
        pg_url = f"postgresql://complilens:complilens_password@localhost:{port}/complilens"
        try:
            engine = create_engine(pg_url, pool_pre_ping=True, connect_args={"connect_timeout": 1})
            with engine.connect() as conn:
                print(f"[DB] Connected successfully to PostgreSQL on port {port}!")
                logger.info(f"Connected to local PostgreSQL database on port {port}.")
            return engine
        except Exception as e:
            print(f"[DB] Could not connect to PostgreSQL on port {port}: {e}")
            logger.warning(f"Could not connect to PostgreSQL on port {port}: {e}")

    # 3. Fallback to resilient local SQLite database
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    sqlite_url = f"sqlite:///{SQLITE_DB_PATH.as_posix()}"
    engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    logger.info(f"Using local SQLite database: {sqlite_url}")
    return engine


engine = get_database_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Initializes all database tables defined on Base."""
    from sqlalchemy import text
    from . import models  # Ensure all model classes are registered with Base
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "postgresql":
        try:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE products ALTER COLUMN net_quantity TYPE TEXT;"))
                conn.execute(text("ALTER TABLE products ALTER COLUMN common_name TYPE TEXT;"))
                conn.execute(text("ALTER TABLE products ALTER COLUMN normalized_name TYPE TEXT;"))
                conn.execute(text("ALTER TABLE products ALTER COLUMN product_key TYPE VARCHAR(255);"))
                conn.execute(text("ALTER TABLE packages ALTER COLUMN product_key TYPE VARCHAR(255);"))
                conn.execute(text("ALTER TABLE packages ALTER COLUMN image_filename TYPE TEXT;"))
                conn.execute(text("ALTER TABLE evaluations ALTER COLUMN evidence_crop_url TYPE TEXT;"))
                conn.commit()
        except Exception as _alter_err:
            pass
    print(f"[DB] Tables initialized on database: {engine.url.render_as_string(hide_password=True)}")


# Auto-create tables on module import so any session/test client has tables ready
try:
    init_db()
except Exception as _e:
    logger.warning(f"Could not auto-initialize tables: {_e}")


def get_db():
    """FastAPI Dependency for yielding database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
