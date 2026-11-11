"""tipos de reserva: tabla tipos_reserva, tipos iniciales y tipo de cada reserva

Revision ID: c7e1a4d9b382
Revises: b4d8e2f6a913
"""
import os
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c7e1a4d9b382"
down_revision = "b4d8e2f6a913"
branch_labels = None
depends_on = None

# Los tipos por persona arrancan con el máximo por reserva del .env (env.py ya lo cargó)
MAX_PERSONAS_POR_RESERVA = int(os.getenv("MAX_PERSONAS_POR_RESERVA", "10"))

# Tipos que hasta ahora solo existían en el frontend, con los precios de Disponibilidad.tsx
TIPOS_INICIALES = [
    {
        "nombre": "Entrada general",
        "precio": 5000,
        "forma_cobro": "POR_PERSONA",
        "max_personas": MAX_PERSONAS_POR_RESERVA,
        "cantidad_unidades": None,
    },
    {
        "nombre": "Carpa",
        "precio": 5000,
        "forma_cobro": "POR_PERSONA",
        "max_personas": MAX_PERSONAS_POR_RESERVA,
        "cantidad_unidades": None,
    },
    {
        "nombre": "Cabaña",
        "precio": 25000,
        "forma_cobro": "POR_UNIDAD",
        "max_personas": 6,
        "cantidad_unidades": 4,
    },
]

forma_cobro_enum = postgresql.ENUM("POR_PERSONA", "POR_UNIDAD", name="formacobroenum", create_type=False)


def upgrade() -> None:
    forma_cobro_enum.create(op.get_bind(), checkfirst=True)

    tipos = op.create_table(
        "tipos_reserva",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("nombre", sa.String(80), nullable=False),
        sa.Column("precio", sa.Numeric(10, 2), nullable=False),
        sa.Column("forma_cobro", forma_cobro_enum, nullable=False),
        sa.Column("max_personas", sa.Integer(), nullable=False),
        sa.Column("cantidad_unidades", sa.Integer(), nullable=True),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint("precio > 0", name="ck_tipos_reserva_precio"),
        sa.CheckConstraint("max_personas > 0", name="ck_tipos_reserva_max_personas"),
        sa.CheckConstraint(
            "(forma_cobro = 'POR_PERSONA' AND cantidad_unidades IS NULL) OR "
            "(forma_cobro = 'POR_UNIDAD' AND (cantidad_unidades IS NULL OR cantidad_unidades >= 1))",
            name="ck_tipos_reserva_unidades",
        ),
    )
    # El nombre es único sin distinguir mayúsculas
    op.create_index("uq_tipos_reserva_nombre", "tipos_reserva", [sa.text("lower(nombre)")], unique=True)

    op.bulk_insert(tipos, [{"id": uuid.uuid4(), "activo": True, **tipo} for tipo in TIPOS_INICIALES])

    # Las reservas que ya existen quedan sin tipo: nunca se guardó cuál eligieron
    op.add_column("reservas", sa.Column("tipo_reserva_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_reservas_tipo_reserva_id", "reservas", ["tipo_reserva_id"])
    op.create_foreign_key(
        "fk_reservas_tipo_reserva_id",
        "reservas",
        "tipos_reserva",
        ["tipo_reserva_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_reservas_tipo_reserva_id", "reservas", type_="foreignkey")
    op.drop_index("ix_reservas_tipo_reserva_id", table_name="reservas")
    op.drop_column("reservas", "tipo_reserva_id")
    op.drop_index("uq_tipos_reserva_nombre", table_name="tipos_reserva")
    op.drop_table("tipos_reserva")
    forma_cobro_enum.drop(op.get_bind(), checkfirst=True)
