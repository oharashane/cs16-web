package main

import "os"

func writeFileMode(name, body string) error { return os.WriteFile(name, []byte(body), 0o644) }
