"""descuentos: tabla de descuentos configurables por el administrador

Revision ID: c1e8f5a37d92
Revises: b7d4e2a91c58
Create Date: 2026-10-26 16:30:00.000000

"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c1e8f5a37d92'
down_revision: Union[str, Sequence[str], None] = 'b7d4e2a91c58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# El descuento de socios que ya estaba en el .env pasa a ser el valor inicial de la tabla.
# Se lee del entorno y no de la app, para que la migración no dependa del código.
DESCUENTO_SOCIO = float(os.getenv("PORCENTAJE_DESCUENTO_SOCIO", "0.20"))

# create_type=False porque el tipo se crea a mano en upgrade(), antes de la tabla
aplica_descuento_enum = postgresql.ENUM(
    'socio', 'edad', name='aplicadescuentoenum', create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    aplica_descuento_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'descuentos',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('codigo', sa.String(), nullable=False),
        sa.Column('nombre', sa.String(), nullable=False),
        sa.Column('aplica_a', aplica_descuento_enum, nullable=False),
        sa.Column('porcentaje', sa.Numeric(5, 2), nullable=False),
        sa.Column('edad_min', sa.Integer(), nullable=True),
        sa.Column('edad_max', sa.Integer(), nullable=True),
        sa.Column('activo', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('porcentaje >= 0 AND porcentaje <= 100', name='ck_descuentos_porcentaje'),
        sa.CheckConstraint(
            "(aplica_a = 'socio' AND edad_min IS NULL AND edad_max IS NULL) OR "
            "(aplica_a = 'edad' AND edad_min IS NOT NULL AND edad_max IS NOT NULL "
            "AND edad_min >= 0 AND edad_max <= 120 AND edad_min <= edad_max)",
            name='ck_descuentos_edades',
        ),
    )
    op.create_index(op.f('ix_descuentos_codigo'), 'descuentos', ['codigo'], unique=True)

    # Descuento inicial para socios, con el porcentaje que hasta ahora estaba en el .env.
    # Si el valor del entorno queda fuera de 0-100 %, se ajusta al límite más cercano.
    porcentaje = min(max(round(DESCUENTO_SOCIO * 100, 2), 0), 100)
    op.execute(
        sa.text(
            "INSERT INTO descuentos (id, codigo, nombre, aplica_a, porcentaje, activo) "
            "SELECT gen_random_uuid(), 'socio', 'Descuento para socios', 'socio', :porcentaje, true "
            "WHERE NOT EXISTS (SELECT 1 FROM descuentos WHERE codigo = 'socio')"
        ).bindparams(porcentaje=porcentaje)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_descuentos_codigo'), table_name='descuentos')
    op.drop_table('descuentos')
    aplica_descuento_enum.drop(op.get_bind(), checkfirst=True)
