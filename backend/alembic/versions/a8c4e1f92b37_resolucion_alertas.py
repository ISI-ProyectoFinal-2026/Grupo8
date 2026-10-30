"""alertas de clonación: estado anterior de la reserva y tabla de auditoría de resoluciones

Revision ID: a8c4e1f92b37
Revises: f7a2d9c41b60
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a8c4e1f92b37"
down_revision = "f7a2d9c41b60"
branch_labels = None
depends_on = None

# El tipo ya existe en la base: acá solo se referencia, no se vuelve a crear
estado_reserva_enum = postgresql.ENUM(
    "PENDIENTE", "CONFIRMADA", "CANCELADA", "FINALIZADA", "ALERTA_CLONACION",
    name="estadoreservaenum",
    create_type=False,
)


def upgrade() -> None:
    op.add_column("reservas", sa.Column("estado_antes_alerta", estado_reserva_enum, nullable=True))

    # Las reservas que ya estaban en alerta no tienen estado guardado: se deduce del pago
    op.execute(
        """
        UPDATE reservas
        SET estado_antes_alerta = CASE
            WHEN estado_pago = 'PAGADO' THEN 'CONFIRMADA'::estadoreservaenum
            ELSE 'PENDIENTE'::estadoreservaenum
        END
        WHERE estado_reserva = 'ALERTA_CLONACION'
        """
    )

    op.create_table(
        "resoluciones_alerta",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "reserva_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reservas.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "resuelto_por_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("usuarios.id"), nullable=False,
        ),
        sa.Column("fecha_deteccion", sa.DateTime(), nullable=True),
        sa.Column("fecha_resolucion", sa.DateTime(timezone=True), nullable=False),
        sa.Column("estado_restaurado", estado_reserva_enum, nullable=False),
        sa.Column("nota", sa.String(length=500), nullable=True),
    )
    op.create_index("ix_resoluciones_alerta_reserva_id", "resoluciones_alerta", ["reserva_id"])
    op.create_index("ix_resoluciones_alerta_resuelto_por_id", "resoluciones_alerta", ["resuelto_por_id"])


def downgrade() -> None:
    op.drop_table("resoluciones_alerta")
    op.drop_column("reservas", "estado_antes_alerta")