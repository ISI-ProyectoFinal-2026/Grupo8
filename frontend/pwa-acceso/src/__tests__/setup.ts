import { configure } from '@testing-library/react';

// findBy* y waitFor esperan 1 s por defecto. En una máquina cargada, las pantallas que leen
// IndexedDB o encadenan varias promesas pueden tardar más: se les da hasta 3 s.
// Si algo realmente no aparece, el test sigue fallando, solo que un poco más tarde.
configure({ asyncUtilTimeout: 3000 });
