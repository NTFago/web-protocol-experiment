param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\nginx\certs'),
    [int]$ValidDays = 30
)

$ErrorActionPreference = 'Stop'
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

$rsa = [Security.Cryptography.RSA]::Create(2048)
$subject = [Security.Cryptography.X509Certificates.X500DistinguishedName]::new('CN=localhost')
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
    $subject,
    $rsa,
    [Security.Cryptography.HashAlgorithmName]::SHA256,
    [Security.Cryptography.RSASignaturePadding]::Pkcs1
)

$request.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true)
)
$request.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor
        [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment,
        $true
    )
)
$serverAuth = [Security.Cryptography.OidCollection]::new()
$serverAuth.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1')) | Out-Null
$request.CertificateExtensions.Add(
    [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($serverAuth, $true)
)

$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$san.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'))
$request.CertificateExtensions.Add($san.Build())

$notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
$notAfter = $notBefore.AddDays($ValidDays)
$certificate = $request.CreateSelfSigned($notBefore, $notAfter)
$encoding = [Text.UTF8Encoding]::new($false)

$certificatePath = Join-Path $resolvedOutput 'localhost.crt'
$privateKeyPath = Join-Path $resolvedOutput 'localhost.key'
[IO.File]::WriteAllText($certificatePath, $certificate.ExportCertificatePem(), $encoding)
[IO.File]::WriteAllText($privateKeyPath, $rsa.ExportPkcs8PrivateKeyPem(), $encoding)

Write-Output "Certificate: $certificatePath"
Write-Output "Private key: $privateKeyPath"
Write-Output "Thumbprint: $($certificate.Thumbprint)"
Write-Output "Valid until: $($certificate.NotAfter.ToString('o'))"

$certificate.Dispose()
$rsa.Dispose()

