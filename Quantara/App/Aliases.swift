import QuantaraCore

/// SwiftUI expose son propre type `Transaction` (le contexte d'animation).
/// Dans un fichier qui importe à la fois SwiftUI et `QuantaraCore`, le nom est ambigu :
/// cet alias lève l'ambiguïté sans imposer une qualification complète à chaque usage.
typealias BudgetTransaction = QuantaraCore.Transaction
