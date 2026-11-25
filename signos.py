from datetime import date

def signo(nascimento):
    if not nascimento:
        return ''
    try:
        d=date.fromisoformat(nascimento)
    except (TypeError,ValueError):
        return ''
    limites=(20,19,21,20,21,21,23,23,23,23,22,22)
    signos=('Capricórnio','Aquário','Peixes','Áries','Touro','Gêmeos','Câncer','Leão','Virgem','Libra','Escorpião','Sagitário')
    return signos[(d.month-1+int(d.day>=limites[d.month-1]))%12]
