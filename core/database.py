from sqlalchemy.orm import declarative_base

# Esta es la clase madre de la que heredarán todos los modelos (Usuarios, Reservas, etc.)
Base = declarative_base()