"""reserva_personas: datos de cada persona de la reserva

Revision ID: b7d4e2a91c58
Revises: a3c91e5d7b42
Create Date: 2026-10-25 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b7d4e2a91c58'
down_revision: Union[str, Sequence[str], None] = 'a3c91e5d7b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# create_type=False porque el tipo se crea a mano en upgrade(), antes de la tabla
condicion_persona_enum = postgresql.ENUM(
    'visitante', 'socio', name='condicionpersonaenum', create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    condicion_persona_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'reserva_personas',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('reserva_id', sa.UUID(), nullable=False),
        sa.Column('orden', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(), nullable=False),
        sa.Column('edad', sa.Integer(), nullable=False),
        sa.Column('condicion', condicion_persona_enum, nullable=False),
        sa.Column('dni', sa.String(), nullable=True),
        sa.Column('precio_base', sa.Numeric(12, 2), nullable=False),
        sa.Column('descuento_pct', sa.Numeric(5, 2), nullable=False),
        sa.Column('precio_final', sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(['reserva_id'], ['reservas.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('reserva_id', 'dni', name='uq_reserva_personas_reserva_dni'),
        sa.CheckConstraint('edad >= 0 AND edad <= 120', name='ck_reserva_personas_edad'),
        sa.CheckConstraint(
            'descuento_pct >= 0 AND descuento_pct <= 100', name='ck_reserva_personas_descuento_pct'
        ),
    )
    op.create_index(op.f('ix_reserva_personas_reserva_id'), 'reserva_personas', ['reserva_id'], unique=False)

    # No hay backfill: las reservas anteriores no guardaron edad ni condición de cada persona,
    # así que quedan sin filas en esta tabla (la API devuelve personas = []).


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_reserva_personas_reserva_id'), table_name='reserva_personas')
    op.drop_table('reserva_personas')
    condicion_persona_enum.drop(op.get_bind(), checkfirst=True)
