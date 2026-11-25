//! Keeps the proxy's own requests on the public internet. Signed URLs come from feeds, which may point anywhere, and
//! the proxy must reach neither the machine it runs on nor the network behind it. Requests that go through the proxy
//! the environment sets are that proxy's to allow or refuse, as its address is often a local one.

use std::{
    error::Error,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
};

use reqwest::{
    Client, Url,
    dns::{Addrs, Name, Resolve, Resolving},
    redirect,
};

/// A client that connects straight, if `public_only` to public addresses only. Redirects are left to the caller, which
/// checks each target with [`allows`].
pub fn direct_client(public_only: bool) -> Client {
    let mut builder = Client::builder()
        .no_proxy()
        .redirect(redirect::Policy::none());
    if public_only {
        builder = builder.dns_resolver(Arc::new(PublicOnly));
    }
    builder.build().expect("TLS backend initializes")
}

/// A client that goes through the proxy the environment sets, whatever its address.
pub fn proxied_client() -> Client {
    Client::builder()
        .redirect(redirect::Policy::none())
        .build()
        .expect("TLS backend initializes")
}

/// Whether [`direct_client`] may fetch `url`: its resolver leaves out the addresses written in URLs.
pub fn allows(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    // IPv6 addresses come bracketed
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .map_or(true, is_public)
}

async fn public_addresses(host: &str) -> Result<Vec<SocketAddr>, Box<dyn Error + Send + Sync>> {
    let found = tokio::net::lookup_host((host, 0)).await?;
    let addrs: Vec<_> = found.filter(|addr| is_public(addr.ip())).collect();
    if addrs.is_empty() {
        return Err(format!("{host} has no public address").into());
    }
    Ok(addrs)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(ip) => is_public_v4(ip),
            None => is_public_v6(ip),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [first, second, ..] = ip.octets();
    let shared = first == 100 && second & 0xC0 == 64;
    let reserved = first == 0 || first >= 240;
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || shared
        || reserved)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip.is_unique_local()
        || ip.is_unicast_link_local())
}

/// Resolves host names to their public addresses only.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addrs = public_addresses(name.as_str()).await?;
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_public_addresses_from_the_rest() {
        let cases = [
            ("93.184.215.14", true),
            ("2606:2800:21f:cb07:6820:80da:af6b:8b2c", true),
            ("127.0.0.1", false),
            ("10.1.2.3", false),
            ("172.16.0.1", false),
            ("192.168.1.1", false),
            ("169.254.169.254", false),
            ("100.64.0.1", false),
            ("0.0.0.0", false),
            ("255.255.255.255", false),
            ("224.0.0.1", false),
            ("240.0.0.1", false),
            ("::1", false),
            ("::", false),
            ("fd00::1", false),
            ("fe80::1", false),
            ("ff02::1", false),
            ("::ffff:127.0.0.1", false),
            ("::ffff:93.184.215.14", true),
        ];
        for (ip, public) in cases {
            assert_eq!(is_public(ip.parse().unwrap()), public, "{ip}");
        }
    }

    #[test]
    fn allows_only_public_addresses_written_in_urls() {
        let cases = [
            ("http://93.184.215.14/a.png", true),
            ("http://127.0.0.1:8080/a.png", false),
            ("http://[::1]/a.png", false),
            // A decimal address is still an address
            ("http://2130706433/a.png", false),
            // Host names are the resolver's
            ("http://example.com/a.png", true),
        ];
        for (url, allowed) in cases {
            assert_eq!(allows(&Url::parse(url).unwrap()), allowed, "{url}");
        }
    }

    #[tokio::test]
    async fn resolves_only_to_public_addresses() {
        let name: Name = "localhost".parse().unwrap();
        assert!(PublicOnly.resolve(name).await.is_err());
    }
}
