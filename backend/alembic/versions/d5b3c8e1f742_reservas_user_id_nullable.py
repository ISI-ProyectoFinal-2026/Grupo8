"""reservas: user_id pasa a admitir nulos (reservas sin cuenta)

Revision ID: d5b3c8e1f742
Revises: c3f81a5d9e07
Create Date: 2026-10-27 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd5b3c8e1f742'
down_revision: Union[str, Sequence[str], None] = 'c3f81a5d9e07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Solo se quita el NOT NULL: las reservas existentes conservan su user_id y la clave foránea sigue igual
    op.alter_column(
        'reservas', 'user_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    # Una reserva sin cuenta no tiene a quién asignarse: se frena en vez de borrar o inventar un usuario
    sin_usuario = op.get_bind().execute(
        sa.text("SELECT COUNT(*) FROM reservas WHERE user_id IS NULL")
    ).scalar()
    if sin_usuario:
        raise RuntimeError(
            f"No se puede volver atrás: hay {sin_usuario} reserva(s) sin usuario (reservas sin cuenta). "
            "Asignales un usuario antes de revertir esta migración."
        )
    op.alter_column(
        'reservas', 'user_id',
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
