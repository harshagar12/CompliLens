"""
SQLAlchemy ORM models for CompliLens.
Defines persistent schema for packages, declarations, evaluations, verdicts,
review queue, product identity resolution (§8.3), and manufacturer portfolios (§8.5).
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    DateTime,
    Text,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from .connection import Base


class ManufacturerModel(Base):
    __tablename__ = "manufacturers"

    manufacturer_key = Column(String(255), primary_key=True, index=True)
    raw_name_address = Column(Text, nullable=False)
    normalized_name = Column(String(255), index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    products = relationship("ProductModel", back_populates="manufacturer", cascade="all, delete-orphan")


class ProductModel(Base):
    __tablename__ = "products"

    product_key = Column(String(255), primary_key=True, index=True)
    manufacturer_key = Column(String(255), ForeignKey("manufacturers.manufacturer_key", ondelete="CASCADE"), nullable=False, index=True)
    common_name = Column(Text, nullable=False, index=True)
    normalized_name = Column(Text, nullable=False, index=True)
    net_quantity = Column(Text, nullable=True)
    category = Column(String(100), default="packaged_food", nullable=False)
    barcode = Column(String(100), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    manufacturer = relationship("ManufacturerModel", back_populates="products")
    packages = relationship("PackageModel", back_populates="product", cascade="all, delete-orphan")


class PackageModel(Base):
    __tablename__ = "packages"

    package_id = Column(String(100), primary_key=True, index=True)
    product_key = Column(String(255), ForeignKey("products.product_key", ondelete="SET NULL"), nullable=True, index=True)
    category = Column(String(100), default="packaged_food", nullable=False)
    image_filename = Column(Text, nullable=False)
    status = Column(String(50), default="UPLOADED", nullable=False)  # UPLOADED, EXTRACTED, REVIEWED, EVALUATED
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    product = relationship("ProductModel", back_populates="packages")
    fields = relationship("ExtractedFieldModel", back_populates="package", cascade="all, delete-orphan")
    evaluations = relationship("EvaluationModel", back_populates="package", cascade="all, delete-orphan")
    verdict = relationship("PackageVerdictModel", back_populates="package", uselist=False, cascade="all, delete-orphan")
    review_items = relationship("ReviewQueueModel", back_populates="package", cascade="all, delete-orphan")


class ExtractedFieldModel(Base):
    __tablename__ = "extracted_fields"

    id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(String(80), ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False, index=True)
    field_name = Column(String(80), nullable=False, index=True)
    raw_value = Column(Text, nullable=False)
    suggested_value = Column(Text, nullable=True)
    suggestion_source = Column(String(50), nullable=True)
    confirmed_value = Column(Text, nullable=True)
    reviewer_action = Column(String(50), nullable=True)
    confidence = Column(Float, default=1.0, nullable=False)
    bbox_x = Column(Integer, default=0, nullable=False)
    bbox_y = Column(Integer, default=0, nullable=False)
    bbox_w = Column(Integer, default=0, nullable=False)
    bbox_h = Column(Integer, default=0, nullable=False)
    ocr_source = Column(String(50), default="local", nullable=False)

    package = relationship("PackageModel", back_populates="fields")

    __table_args__ = (
        Index("idx_pkg_field", "package_id", "field_name"),
    )


class EvaluationModel(Base):
    __tablename__ = "evaluations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(String(80), ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False, index=True)
    evaluation_id = Column(String(80), nullable=False, index=True)
    field_name = Column(String(80), nullable=False, index=True)
    rule_id = Column(String(80), nullable=False, index=True)
    rule_version = Column(Integer, default=1, nullable=False)
    result = Column(String(20), nullable=False)  # PASS, FAIL, NEEDS_REVIEW
    extracted_value = Column(Text, nullable=True)
    confidence = Column(Float, default=1.0, nullable=False)
    evidence_crop_url = Column(String(255), default="", nullable=False)
    notes = Column(Text, default="", nullable=False)

    package = relationship("PackageModel", back_populates="evaluations")


class PackageVerdictModel(Base):
    __tablename__ = "package_verdicts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    package_id = Column(String(80), ForeignKey("packages.package_id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    overall_result = Column(String(20), nullable=False)  # PASS, FAIL, NEEDS_REVIEW
    category = Column(String(50), default="packaged_food", nullable=False)
    evaluated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    package = relationship("PackageModel", back_populates="verdict")


class ReviewQueueModel(Base):
    __tablename__ = "review_queue"

    evaluation_id = Column(String(80), primary_key=True, index=True)
    package_id = Column(String(80), ForeignKey("packages.package_id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(30), default="PENDING_REVIEW", nullable=False)  # PENDING_REVIEW, APPROVE, OVERRIDE_PASS, OVERRIDE_FAIL
    decision = Column(String(30), nullable=True)
    reviewer = Column(String(100), nullable=True)
    note = Column(Text, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    package = relationship("PackageModel", back_populates="review_items")
