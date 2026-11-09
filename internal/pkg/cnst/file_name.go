package cnst

// ASCIIFolds maps lower-case accented Latin letters (precomposed, incl. Vietnamese) to their ASCII letter.
var ASCIIFolds = func() map[rune]rune {
	folds := map[rune]rune{'ð': 'd', 'ø': 'o', 'ł': 'l', 'ß': 's', 'æ': 'a', 'œ': 'o'}
	for base, accented := range map[rune]string{
		'a': "àáảãạăằắẳẵặâầấẩẫậäåāąǎ",
		'e': "èéẻẽẹêềếểễệëēęěė",
		'i': "ìíỉĩịïîīįı",
		'o': "òóỏõọôồốổỗộơờớởỡợöōőǒ",
		'u': "ùúủũụưừứửữựüûūůűųǔ",
		'y': "ỳýỷỹỵÿ",
		'c': "çćčĉċ",
		'n': "ñńňņ",
		's': "śšşŝș",
		'z': "źžż",
		'g': "ğĝġģ",
		'r': "řŕŗ",
		't': "ťţț",
		'd': "ďđ",
		'l': "ĺľļ",
	} {
		for _, r := range accented {
			folds[r] = base
		}
	}
	return folds
}()

// WindowsReservedNames are the lower-case device names Windows does not allow as a file name stem.
var WindowsReservedNames = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}
