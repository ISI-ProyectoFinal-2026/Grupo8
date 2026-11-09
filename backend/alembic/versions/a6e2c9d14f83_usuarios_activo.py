"""usuarios: baja lógica (columna activo)

Revision ID: a6e2c9d14f83
Revises: d2f7b4c8e913
Create Date: 2026-11-08 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a6e2c9d14f83'
down_revision: Union[str, Sequence[str], None] = 'd2f7b4c8e913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Con el valor por defecto en la base, los usuarios que ya existen quedan activos
    op.add_column(
        'usuarios',
        sa.Column('activo', sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column('usuarios', 'activo')
